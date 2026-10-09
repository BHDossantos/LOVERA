"""Per-member feature snapshot used by eligibility, scoring and explanation. Built once per batch."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog.signals import SIGNALS
from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.models.account import Member
from app.models.availability import AvailabilityVersion
from app.models.blueprint import BlueprintSignal, BlueprintVersion, Preference
from app.models.profile import Profile
from app.models.verification import Verification


@dataclass
class Snapshot:
    member: Member
    profile: Profile
    signals: dict[str, str]
    confidences: dict[str, str]
    preferences: list[Preference]
    windows: list[dict[str, Any]]
    date_styles: list[str]
    verified: bool
    blueprint_age_days: int | None
    age: int | None
    special_category_consent: bool = False
    languages: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.member.id

    @property
    def display_name(self) -> str:
        return self.profile.display_name or "Member"


def is_sensitive_preference(key: str) -> bool:
    """Whether this preference asks about a special-category signal.

    Public because the consent rule has to hold everywhere a preference is read, not only here:
    the payload that tells a member whether a criterion is enforced, and the impact preview that
    counts who it lets through, both have to agree with what the matcher actually does.
    """
    from app.catalog.signals import PREFERENCES

    pdef = PREFERENCES.get(key)
    target = SIGNALS.get(pdef.target) if pdef else None
    return bool(target and target.special_category)


def build_snapshot(db: Session, member: Member) -> Snapshot | None:
    profile = db.get(Profile, member.id)
    if profile is None:
        return None
    from app.modules.account.service import has_consent

    # Consent is the lawful basis for a special-category signal, so withdrawing it has to stop
    # the processing, not just the collection. `special_category_consent` was being set on this
    # snapshot and read by nothing: the faith row stayed in the database, which is correct, and
    # kept being scored, which is not. Leaving it out here is the one place that reaches every
    # consumer — similarity, preferences and explanations all read the snapshot, never the rows.
    #
    # The row is not deleted and the member still sees it on their Blueprint. A partner whose
    # preference asks about it gets "unknown" rather than a rejection, which is what
    # preference_satisfied already returns for a signal it has no answer for.
    sensitive_ok = has_consent(db, member.id, "special_category")
    version = db.execute(select(BlueprintVersion).where(BlueprintVersion.member_id == member.id, BlueprintVersion.status == "confirmed")).scalar_one_or_none()
    signals: dict[str, str] = {}
    confidences: dict[str, str] = {}
    if version:
        for s in db.execute(select(BlueprintSignal).where(BlueprintSignal.blueprint_version_id == version.id)).scalars():
            if s.key in SIGNALS and (sensitive_ok or not SIGNALS[s.key].special_category):
                signals[s.key] = s.normalized_value.get("value")
                confidences[s.key] = s.confidence
    # The same rule on the other side of the comparison. Dropping the member's own faith signal
    # stopped them being ranked on it; a faith *preference* they set while consented kept ranking
    # and gating other people by theirs, because directional_fit() and hard_gate() both iterate
    # viewer.preferences. Withdrawing consent has to end both halves of that processing.
    prefs = [
        pref
        for pref in db.execute(select(Preference).where(Preference.member_id == member.id)).scalars().all()
        if sensitive_ok or not is_sensitive_preference(pref.key)
    ]
    availability = db.execute(select(AvailabilityVersion).where(AvailabilityVersion.member_id == member.id).order_by(AvailabilityVersion.created_at.desc())).scalars().first()
    ver = db.execute(select(Verification).where(Verification.member_id == member.id, Verification.status == "verified").order_by(Verification.created_at.desc())).scalars().first()
    verified = bool(ver and (ver.expires_at is None or ver.expires_at > utcnow()))
    from app.modules.account.service import age_on

    return Snapshot(
        member=member,
        profile=profile,
        signals=signals,
        confidences=confidences,
        preferences=prefs,
        windows=list(availability.recurring_windows) if availability else [],
        date_styles=list(availability.date_styles) if availability else [],
        verified=verified,
        blueprint_age_days=(utcnow() - version.confirmed_at).days if version and version.confirmed_at else None,
        age=age_on(member.birth_date, utcnow().date()) if member.birth_date else None,
        special_category_consent=sensitive_ok,
        languages=list(profile.languages or []),
    )


def is_fresh(snapshot: Snapshot) -> bool:
    settings = get_settings()
    return snapshot.blueprint_age_days is not None and snapshot.blueprint_age_days <= settings.blueprint_freshness_days
