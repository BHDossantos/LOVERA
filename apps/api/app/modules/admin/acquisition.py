"""Restricted, event-based onboarding cohorts for the reviewed acquisition placements.

Each member belongs to their first recorded signup, even if a duplicate event is later emitted.
Milestones mean an event was recorded after that signup; they are not current eligibility or
activity. Fixed rows, small-cell suppression and no totals avoid exposing small cohorts through
labels or subtraction. This is disclosure reduction, not a claim of anonymous source events.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.catalog.campaigns import CAMPAIGNS, resolve_campaign
from app.core.analytics import anon_key
from app.core.errors import ApiError
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.privacy import AnalyticsEvent

MINIMUM_COHORT_SIZE = 5
WINDOW_DAYS = (7, 30, 90)
STAGES = ("verification_completed", "blueprint_confirmed", "profile_completed")
STAFF_ROLES = ("concierge", "safety_reviewer", "support", "admin")


def _cohort(properties: dict[str, Any]) -> str:
    campaign = resolve_campaign(properties.get("campaign_code"))
    if campaign:
        return campaign.code
    # Historical/unknown fields are neither echoed nor used as a new grouping dimension.
    return "invite" if properties.get("acquisition_channel") == "invite" else "direct"


def _counts(member_keys: set[str], milestones: dict[str, set[str]]) -> dict[str, int | None]:
    size = len(member_keys)
    counts: dict[str, int | None] = {"signups": size if size >= MINIMUM_COHORT_SIZE else None}
    for stage in STAGES:
        count = len(member_keys & milestones[stage])
        remaining = size - count
        # Suppress the complementary small group too: 6 signups and 5 completions would reveal
        # that exactly one member has not recorded the milestone. Zero is hidden just like 1–4.
        counts[stage] = count if size >= MINIMUM_COHORT_SIZE and count >= MINIMUM_COHORT_SIZE and (remaining == 0 or remaining >= MINIMUM_COHORT_SIZE) else None
    return counts


def report(db: Session, days: int) -> dict[str, Any]:
    if days not in WINDOW_DAYS:
        raise ApiError("VALIDATION_ERROR", "Choose a 7, 30 or 90 day window.", field_errors={"days": "Choose 7, 30 or 90."})
    end = utcnow()
    start = end - timedelta(days=days)

    # Only staff ids cross into this process; their pseudonymous keys are used for exclusion and
    # never returned. This also excludes a member who was subsequently given a staff role.
    staff_ids = db.execute(select(Member.id).where(or_(*(Member.roles.contains([role]) for role in STAFF_ROLES)))).scalars()
    staff_keys = [anon_key(member_id) for member_id in staff_ids]

    ranked_signups = select(
        AnalyticsEvent.anon_member_key.label("member_key"),
        AnalyticsEvent.properties,
        AnalyticsEvent.occurred_at.label("signup_at"),
        func.row_number().over(
            partition_by=AnalyticsEvent.anon_member_key,
            order_by=(AnalyticsEvent.occurred_at, AnalyticsEvent.id),
        ).label("signup_number"),
    ).where(
        AnalyticsEvent.event == "account_created",
        AnalyticsEvent.anon_member_key.is_not(None),
        AnalyticsEvent.occurred_at <= end,
    ).subquery()
    # Apply the cutoff AFTER selecting the first-ever signup. Duplicate recent events must not
    # pull an old member into the new-member denominator.
    signups_query = select(
        ranked_signups.c.member_key,
        ranked_signups.c.properties,
        ranked_signups.c.signup_at,
    ).where(
        ranked_signups.c.signup_number == 1,
        ranked_signups.c.signup_at >= start,
    )
    if staff_keys:
        signups_query = signups_query.where(ranked_signups.c.member_key.not_in(staff_keys))
    signups = signups_query.cte("acquisition_signups")

    groups: dict[str, set[str]] = {code: set() for code in CAMPAIGNS}
    groups.update({"direct": set(), "invite": set()})
    for key, properties, _ in db.execute(select(signups)):
        groups[_cohort(properties)].add(key)

    milestones: dict[str, set[str]] = {stage: set() for stage in STAGES}
    completed = select(AnalyticsEvent.anon_member_key, AnalyticsEvent.event).join(
        signups, AnalyticsEvent.anon_member_key == signups.c.member_key,
    ).where(
        AnalyticsEvent.event.in_(STAGES),
        AnalyticsEvent.occurred_at >= signups.c.signup_at,
        AnalyticsEvent.occurred_at <= end,
        or_(
            AnalyticsEvent.event != "verification_completed",
            AnalyticsEvent.properties["status"].astext == "verified",
        ),
    ).distinct()
    for key, event in db.execute(completed):
        milestones[event].add(key)

    cohorts = [
        {"campaign_code": campaign.code, "source": campaign.source, "label": campaign.label, **_counts(groups[campaign.code], milestones)}
        for campaign in CAMPAIGNS.values()
    ]
    for source, label in (("direct", "Direct / unattributed"), ("invite", "Invitation / unattributed")):
        cohorts.append({"campaign_code": None, "source": source, "label": label, **_counts(groups[source], milestones)})
    return {
        "days": days,
        "window_start": iso(start),
        "window_end": iso(end),
        "minimum_cohort_size": MINIMUM_COHORT_SIZE,
        "campaigns": [asdict(campaign) for campaign in CAMPAIGNS.values()],
        "cohorts": cohorts,
    }
