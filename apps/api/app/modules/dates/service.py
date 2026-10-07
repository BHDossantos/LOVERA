"""Date plans: coarse availability intersection, safe public venues, proposal/response with reconfirmation, check-in, feedback."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.catalog.cities import ZONES, haversine_km
from app.core.analytics import bucket, track
from app.core.audit import audit
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.events import publish
from app.core.timeutil import iso, utcnow
from app.core.windows import WEEKDAYS, day_intervals, intersect
from app.models.account import Member
from app.models.availability import AvailabilityVersion
from app.models.conversations import Conversation
from app.models.dates import DateCheckIn, DatePlan, PostDateFeedback, Venue
from app.models.profile import Profile
from app.modules.billing.service import entitlements_for
from app.modules.conversations.realtime import hub
from app.modules.dates.venues import venue_payload
from app.modules.notifications.service import notify

CANCEL_REASONS = ("schedule", "not_feeling_it", "illness", "safety", "other")


def _availability(db: Session, member_id: str) -> AvailabilityVersion | None:
    return db.execute(select(AvailabilityVersion).where(AvailabilityVersion.member_id == member_id).order_by(AvailabilityVersion.created_at.desc())).scalars().first()


def _timezone_of(db: Session, member_id: str) -> str:
    member = db.get(Member, member_id)
    return (member.timezone if member else None) or get_settings().market_timezone


def overlaps(db: Session, a_id: str, b_id: str, tz: str, horizon_days: int = 14) -> list[dict[str, Any]]:
    """Slots both members are free for, as instants, expressed in `tz` for display.

    Each member's windows are read in *their own* zone. The previous version applied the single `tz`
    it was given — the proposing member's, or the plan's — to both members' windows, so two members
    an hour apart were offered a slot an hour outside one of their stated evenings, and the date they
    confirmed was not the date one of them thought they had agreed to. `tz` is now only the zone the
    result is written in, which is what the caller actually wanted it for.

    Days are built per member in their own zone, so a window's offset is the one in force on its own
    date rather than one offset applied to a fortnight — correct across a DST change.
    """
    av_a, av_b = _availability(db, a_id), _availability(db, b_id)
    if not av_a or not av_b:
        return []
    a_tz, b_tz = _timezone_of(db, a_id), _timezone_of(db, b_id)
    zone = ZoneInfo(tz)
    now = utcnow()
    # One day either side of the horizon, because a window late in the evening of one member's local
    # day can be early the next day in the other's.
    span = horizon_days + 2

    def local_days(name: str) -> list[date]:
        first = now.astimezone(ZoneInfo(name)).date() - timedelta(days=1)
        return [first + timedelta(days=i) for i in range(span)]

    away_a = {e.get("date") for e in av_a.dated_exceptions if e.get("available") is False}
    away_b = {e.get("date") for e in av_b.dated_exceptions if e.get("available") is False}
    # A member's "I am away that day" is a date in their calendar, not in whoever is looking.
    a_zone, b_zone = ZoneInfo(a_tz), ZoneInfo(b_tz)

    # Not today: a first date is arranged, not sprung. This is the horizon the old version walked.
    earliest = now.astimezone(zone).date() + timedelta(days=1)
    latest = now.astimezone(zone).date() + timedelta(days=horizon_days)

    out: list[dict[str, Any]] = []
    for starts_at, ends_at in intersect(
        day_intervals(av_a.recurring_windows, a_tz, local_days(a_tz)),
        day_intervals(av_b.recurring_windows, b_tz, local_days(b_tz)),
    ):
        if starts_at <= now:
            continue
        local, local_end = starts_at.astimezone(zone), ends_at.astimezone(zone)
        if not (earliest <= local.date() <= latest):
            continue
        if starts_at.astimezone(a_zone).date().isoformat() in away_a:
            continue
        if starts_at.astimezone(b_zone).date().isoformat() in away_b:
            continue
        out.append(
            {
                "date": local.date().isoformat(),
                "weekday": WEEKDAYS[local.weekday()],
                "start": local.strftime("%H:%M"),
                "end": local_end.strftime("%H:%M"),
                "starts_at": iso(starts_at),
                "ends_at": iso(ends_at),
            }
        )
    return out[:12]


def get_plan(db: Session, plan_id: str, member_id: str, lock: bool = False) -> DatePlan:
    q = select(DatePlan).where(DatePlan.id == plan_id)
    if lock:
        q = q.with_for_update()
    plan = db.execute(q).scalar_one_or_none()
    if plan is None or not plan.has_participant(member_id):
        raise ApiError("NOT_FOUND")
    return plan


def create_plan(db: Session, conv_id: str, member: Member) -> DatePlan:
    conv = db.get(Conversation, conv_id)
    if conv is None or not conv.has_participant(member.id):
        raise ApiError("NOT_FOUND")
    if conv.status != "active":
        raise ApiError("CONFLICT", "This conversation has ended.")
    existing = db.execute(select(DatePlan).where(DatePlan.conversation_id == conv.id, DatePlan.status.in_(("draft", "proposed", "countered", "confirmed")))).scalars().first()
    if existing:
        return existing
    plan = DatePlan(conversation_id=conv.id, member_a_id=conv.member_a_id, member_b_id=conv.member_b_id, status="draft", timezone=member.timezone, history=[{"by": member.id, "action": "created", "at": iso(utcnow())}])
    db.add(plan)
    db.flush()
    return plan


def venue_shortlist(db: Session, plan: DatePlan, member: Member, style: str | None = None) -> list[dict[str, Any]]:
    """Three public options balanced for travel between both members' coarse zones."""
    other = db.get(Member, plan.other(member.id))
    venues = db.execute(select(Venue).where(Venue.market_id == member.market_id, Venue.active.is_(True), Venue.public_place.is_(True))).scalars().all()
    za, zb = ZONES.get(member.home_zone_id or ""), ZONES.get(other.home_zone_id or "") if other else None
    scored = []
    for v in venues:
        if style and style not in v.categories:
            continue
        zv = ZONES.get(v.zone_id)
        if za and zb and zv:
            da, dbb = haversine_km(za.lat, za.lon, zv.lat, zv.lon), haversine_km(zb.lat, zb.lon, zv.lat, zv.lon)
            balance = abs(da - dbb)
            total = da + dbb
        else:
            balance, total, da, dbb = 0.0, 0.0, 0.0, 0.0
        scored.append((balance * 1.5 + total, v, da, dbb))
    scored.sort(key=lambda t: t[0])
    return [{**venue_payload(v), "travel": {"you_km_band": _band(da), "them_km_band": _band(dbb)}} for _, v, da, dbb in scored[:3]]


def _band(km: float) -> str:
    return "0-2" if km < 2 else "2-5" if km < 5 else "5-10" if km < 10 else "10+"


def propose(db: Session, plan_id: str, member: Member, starts_at: datetime, duration_minutes: int, venue_id: str, date_style: str | None, if_match: str | None, idempotency_key: str | None) -> DatePlan:
    plan = get_plan(db, plan_id, member.id, lock=True)
    if if_match and if_match.strip('"') != str(plan.version):
        raise ApiError("VERSION_MISMATCH", "The plan changed. Reload before proposing.")
    if plan.status in ("cancelled", "completed", "no_show", "disputed"):
        raise ApiError("CONFLICT", "This plan is closed.")
    venue = db.get(Venue, venue_id)
    if venue is None or not venue.public_place or venue.market_id != member.market_id:
        raise ApiError("VALIDATION_ERROR", "Choose a public venue from the shortlist.", field_errors={"venue_id": "invalid"})
    if starts_at <= utcnow() + timedelta(hours=2):
        raise ApiError("VALIDATION_ERROR", "Propose a time at least two hours from now.", field_errors={"starts_at": "too_soon"})
    if idempotency_key and any(h.get("idempotency_key") == idempotency_key for h in plan.history):
        return plan
    changed = []
    if plan.starts_at != starts_at:
        changed.append("time")
    if plan.venue_id != venue_id:
        changed.append("venue")
    plan.starts_at = starts_at
    plan.ends_at = starts_at + timedelta(minutes=max(60, min(240, duration_minutes)))
    plan.venue_id = venue.id
    plan.venue_snapshot = venue_payload(venue)
    plan.date_style = date_style
    plan.proposed_by = member.id
    plan.status = "countered" if plan.status in ("proposed", "countered", "confirmed") and plan.proposed_by != member.id else "proposed"
    plan.status = "proposed" if plan.status == "draft" else plan.status
    plan.confirmations = [member.id]  # proposer confirms their own proposal; the other must reconfirm
    plan.confirmed_at = None
    plan.version += 1
    plan.history = [*plan.history, {"by": member.id, "action": "proposed", "at": iso(utcnow()), "changed_fields": changed or ["time", "venue"], "idempotency_key": idempotency_key}]
    other_id = plan.other(member.id)
    lead_h = (starts_at - utcnow()).total_seconds() / 3600
    track(db, "date_proposed", member.id, time_distance_bucket="<48h" if lead_h < 48 else "<7d" if lead_h < 168 else ">=7d", venue_category=(venue.categories or ["other"])[0])
    notify(db, other_id, "date_proposed", "dates", "A date was proposed", f"{_name(db, member.id)} proposed {venue.name} on {starts_at.astimezone(ZoneInfo(plan.timezone)).strftime('%A %d %B at %H:%M')}. Confirm or suggest a change.", f"/dates/{plan.id}", dedupe_key=f"date_proposed:{plan.id}:{plan.version}")
    hub.push(other_id, {"type": "date_plan.updated", "date_plan_id": plan.id, "status": plan.status, "version": plan.version, "changed_fields": changed})
    audit(db, actor_type="member", actor_id=member.id, action="date.proposed", resource_type="date_plan", resource_id=plan.id, metadata={"changed": changed})
    return plan


def respond(db: Session, plan_id: str, member: Member, action: str, if_match: str | None) -> DatePlan:
    plan = get_plan(db, plan_id, member.id, lock=True)
    if if_match and if_match.strip('"') != str(plan.version):
        raise ApiError("VERSION_MISMATCH", "The plan changed. Reload before responding.")
    if plan.status not in ("proposed", "countered"):
        raise ApiError("CONFLICT", "There is no open proposal to respond to.")
    if action == "accept":
        if member.id not in plan.confirmations:
            plan.confirmations = [*plan.confirmations, member.id]
        if set(plan.confirmations) == {plan.member_a_id, plan.member_b_id}:
            plan.status = "confirmed"
            plan.confirmed_at = utcnow()
            plan.version += 1
            lead_h = (plan.starts_at - utcnow()).total_seconds() / 3600 if plan.starts_at else 0
            for mid in (plan.member_a_id, plan.member_b_id):
                track(db, "date_confirmed", mid, lead_time_bucket="<48h" if lead_h < 48 else "<7d" if lead_h < 168 else ">=7d", venue_category=(plan.venue_snapshot.get("categories") or ["other"])[0])
                notify(db, mid, "date_confirmed", "dates", "Date confirmed", f"{plan.venue_snapshot.get('name')} on {plan.starts_at.astimezone(ZoneInfo(plan.timezone)).strftime('%A %d %B at %H:%M')}. Set up a check-in if you'd like.", f"/dates/{plan.id}", dedupe_key=f"date_confirmed:{plan.id}:{mid}")
                hub.push(mid, {"type": "date_plan.updated", "date_plan_id": plan.id, "status": "confirmed", "version": plan.version, "changed_fields": []})
            publish(db, "date.confirmed", "date_plan", plan.id, {"members": [plan.member_a_id, plan.member_b_id]}, dedupe_key=f"date.confirmed:{plan.id}:{plan.version}")
    elif action == "decline":
        plan.status = "draft"
        plan.confirmations = []
        plan.version += 1
        other = plan.other(member.id)
        notify(db, other, "date_declined", "dates", "Time didn't work", f"{_name(db, member.id)} can't make that time. Suggest another window.", f"/dates/{plan.id}", dedupe_key=f"date_declined:{plan.id}:{plan.version}")
        hub.push(other, {"type": "date_plan.updated", "date_plan_id": plan.id, "status": "draft", "version": plan.version, "changed_fields": ["time"]})
    else:
        raise ApiError("VALIDATION_ERROR", "Action must be accept or decline (use propose to counter).")
    plan.history = [*plan.history, {"by": member.id, "action": action, "at": iso(utcnow())}]
    audit(db, actor_type="member", actor_id=member.id, action=f"date.{action}", resource_type="date_plan", resource_id=plan.id)
    return plan


def cancel(db: Session, plan_id: str, member: Member, reason: str) -> DatePlan:
    plan = get_plan(db, plan_id, member.id, lock=True)
    if plan.status in ("cancelled", "completed"):
        return plan
    if reason not in CANCEL_REASONS:
        reason = "other"
    plan.status = "cancelled"
    plan.cancelled_at = utcnow()
    plan.cancel_reason = reason
    plan.version += 1
    plan.history = [*plan.history, {"by": member.id, "action": "cancelled", "at": iso(utcnow())}]
    other = plan.other(member.id)
    notify(db, other, "date_cancelled", "dates", "Date cancelled", f"{_name(db, member.id)} cancelled the date. You can plan another time from the chat.", f"/messages/{plan.conversation_id}", dedupe_key=f"date_cancelled:{plan.id}")
    hub.push(other, {"type": "date_plan.updated", "date_plan_id": plan.id, "status": "cancelled", "version": plan.version, "changed_fields": []})
    if reason == "safety":
        notify(db, member.id, "safety_nudge", "safety", "You cancelled for a safety reason", "If something felt wrong, you can block or report from the Safety Center. Reports are private.", "/safety", dedupe_key=f"safety_nudge:{plan.id}:{member.id}")
    audit(db, actor_type="member", actor_id=member.id, action="date.cancelled", resource_type="date_plan", resource_id=plan.id, metadata={"reason": reason})
    return plan


def configure_checkin(db: Session, plan_id: str, member: Member, contact_name: str, contact_channel: str, share_scope: str, check_at: datetime | None, escalation: str) -> DateCheckIn:
    settings = get_settings()
    plan = get_plan(db, plan_id, member.id)
    if plan.status != "confirmed":
        raise ApiError("CONFLICT", "Confirm the date before setting up a check-in.")
    if share_scope not in ("plan", "plan_and_checkin", "plan_checkin_location"):
        raise ApiError("VALIDATION_ERROR", "Unknown share scope.")
    check = check_at or (plan.ends_at or plan.starts_at + timedelta(hours=2))
    existing = db.execute(select(DateCheckIn).where(DateCheckIn.date_plan_id == plan.id, DateCheckIn.member_id == member.id)).scalar_one_or_none()
    expires = (plan.ends_at or check) + timedelta(hours=settings.checkin_location_retention_hours)
    if existing:
        existing.trusted_contact_name, existing.trusted_contact_channel, existing.share_scope, existing.check_at, existing.escalation_preference, existing.expires_at, existing.state = contact_name, contact_channel, share_scope, check, escalation, expires, "scheduled"
        ci = existing
    else:
        ci = DateCheckIn(date_plan_id=plan.id, member_id=member.id, trusted_contact_name=contact_name[:80], trusted_contact_channel=contact_channel[:120], share_scope=share_scope, check_at=check, escalation_preference=escalation, expires_at=expires)
        db.add(ci)
    db.flush()
    lead_h = (plan.starts_at - utcnow()).total_seconds() / 3600 if plan.starts_at else 0
    track(db, "checkin_enabled", member.id, share_scope=share_scope, lead_time_bucket="<48h" if lead_h < 48 else ">=48h")
    audit(db, actor_type="member", actor_id=member.id, action="checkin.configured", resource_type="date_check_in", resource_id=ci.id, metadata={"share_scope": share_scope})
    return ci


def checkin_now(db: Session, plan_id: str, member: Member, state: str, location_note: str | None) -> DateCheckIn:
    plan = get_plan(db, plan_id, member.id)
    ci = db.execute(select(DateCheckIn).where(DateCheckIn.date_plan_id == plan.id, DateCheckIn.member_id == member.id)).scalar_one_or_none()
    if ci is None:
        raise ApiError("NOT_FOUND", "No check-in is configured for this date.")
    if state not in ("checked_in", "escalated"):
        raise ApiError("VALIDATION_ERROR", "State must be checked_in or escalated.")
    ci.state = state
    ci.checked_in_at = utcnow()
    if location_note and ci.share_scope == "plan_checkin_location":
        ci.encrypted_location_ref = f"enc:{hash(location_note) & 0xFFFFFFFF:08x}"  # stored via restricted envelope encryption in production
    if state == "escalated":
        notify(db, member.id, "escalation_ack", "safety", "We've noted your escalation", "Your trusted contact should be reached through your chosen channel. If you are in danger, call local emergency services (112 in Italy and Spain).", "/safety", dedupe_key=f"escalation:{plan.id}:{member.id}:{ci.checked_in_at.isoformat()}")
    audit(db, actor_type="member", actor_id=member.id, action=f"checkin.{state}", resource_type="date_check_in", resource_id=ci.id)
    return ci


def submit_feedback(db: Session, plan_id: str, member: Member, attendance: str, felt_safe: bool | None, enjoyed: str | None, second_date: str | None, fit_reasons: list[str], safety_flag: bool, learning_consent: bool) -> PostDateFeedback:
    plan = get_plan(db, plan_id, member.id)
    if plan.status not in ("confirmed", "completed", "no_show", "disputed"):
        raise ApiError("CONFLICT", "Feedback opens once a date was confirmed.")
    if plan.starts_at and plan.starts_at > utcnow():
        raise ApiError("CONFLICT", "Feedback opens after the date starts.")
    if attendance not in ("attended", "other_no_show", "i_cancelled", "not_yet"):
        raise ApiError("VALIDATION_ERROR", "Unknown attendance value.")
    if second_date not in (None, "yes", "no", "unsure"):
        raise ApiError("VALIDATION_ERROR", "Second-date answer must be yes, no or unsure.")
    fb = db.execute(select(PostDateFeedback).where(PostDateFeedback.date_plan_id == plan.id, PostDateFeedback.member_id == member.id)).scalar_one_or_none()
    if fb is None:
        fb = PostDateFeedback(date_plan_id=plan.id, member_id=member.id, attendance=attendance)
        db.add(fb)
    else:
        fb.revision += 1
        fb.attendance = attendance
    fb.felt_safe, fb.enjoyed, fb.second_date_answer, fb.fit_reasons, fb.safety_flag, fb.learning_consent = felt_safe, enjoyed, second_date, fit_reasons[:5] if learning_consent else [], safety_flag, learning_consent
    fb.submitted_at = utcnow()
    db.flush()
    track(db, "postdate_submitted", member.id, attendance=attendance, answer_present=second_date is not None, safety_flag=safety_flag)
    if safety_flag:
        notify(db, member.id, "safety_route", "safety", "Thank you for telling us", "Safety concerns are handled separately from matching. You can report privately from the Safety Center.", "/safety/report", dedupe_key=f"safety_route:{plan.id}:{member.id}")
    # Attendance reconciliation
    other_fb = db.execute(select(PostDateFeedback).where(PostDateFeedback.date_plan_id == plan.id, PostDateFeedback.member_id == plan.other(member.id))).scalar_one_or_none()
    if attendance == "attended" and plan.status == "confirmed":
        plan.status = "completed"
        plan.completed_at = utcnow()
    elif attendance == "other_no_show" and plan.status == "confirmed":
        plan.status = "no_show"
    if other_fb and {fb.attendance, other_fb.attendance} == {"attended", "other_no_show"}:
        plan.status = "disputed"
    # Mutual second-date reveal: only when both answered yes
    if other_fb and fb.second_date_answer == "yes" and other_fb.second_date_answer == "yes" and fb.reveal_state != "revealed_mutual":
        fb.reveal_state = other_fb.reveal_state = "revealed_mutual"
        intro_at = db.get(Conversation, plan.conversation_id).opened_at
        for mid in (plan.member_a_id, plan.member_b_id):
            track(db, "mutual_second_date", mid, market=member.market_id, cohort="pilot", time_from_intro_bucket=bucket((utcnow() - intro_at).total_seconds()))
            notify(db, mid, "mutual_second_date", "dates", "You both want a second date", "Plan the next one from your chat whenever you're ready.", f"/dates/{plan.id}/mutual-second-date", dedupe_key=f"mutual_second:{plan.id}:{mid}")
        publish(db, "feedback.mutual_second_date", "date_plan", plan.id, {"members": [plan.member_a_id, plan.member_b_id]}, dedupe_key=f"feedback.mutual_second_date:{plan.id}")
    elif other_fb and other_fb.second_date_answer is not None and fb.second_date_answer is not None:
        fb.reveal_state = other_fb.reveal_state = "closed"
    audit(db, actor_type="member", actor_id=member.id, action="feedback.submitted", resource_type="post_date_feedback", resource_id=fb.id, metadata={"attendance": attendance, "safety_flag": safety_flag})
    return fb


def mutual_outcome(db: Session, plan_id: str, member: Member) -> dict[str, Any]:
    plan = get_plan(db, plan_id, member.id)
    mine = db.execute(select(PostDateFeedback).where(PostDateFeedback.date_plan_id == plan.id, PostDateFeedback.member_id == member.id)).scalar_one_or_none()
    if mine is None:
        return {"state": "awaiting_your_feedback", "mutual": False}
    if mine.reveal_state == "revealed_mutual":
        return {"state": "mutual_second_date", "mutual": True, "next_steps": ["Plan a second date from the chat", "Return to the conversation"], "conversation_id": plan.conversation_id}
    # A one-sided yes, a no, or a pending other answer all look the same to protect the other member's privacy.
    return {"state": "no_mutual_result_yet", "mutual": False, "message": "You'll see a result here only if you both said yes. Nothing about a one-sided answer is ever shown."}


def plan_payload(db: Session, plan: DatePlan, viewer: Member) -> dict[str, Any]:
    checkin = db.execute(select(DateCheckIn).where(DateCheckIn.date_plan_id == plan.id, DateCheckIn.member_id == viewer.id)).scalar_one_or_none()
    fb = db.execute(select(PostDateFeedback).where(PostDateFeedback.date_plan_id == plan.id, PostDateFeedback.member_id == viewer.id)).scalar_one_or_none()
    other = db.get(Member, plan.other(viewer.id))
    return {
        "id": plan.id,
        "conversation_id": plan.conversation_id,
        "status": plan.status,
        "timezone": plan.timezone,
        "starts_at": iso(plan.starts_at),
        "ends_at": iso(plan.ends_at),
        "venue": plan.venue_snapshot or None,
        "date_style": plan.date_style,
        "proposed_by_you": plan.proposed_by == viewer.id,
        "you_confirmed": viewer.id in (plan.confirmations or []),
        "awaiting_your_confirmation": plan.status in ("proposed", "countered") and viewer.id not in (plan.confirmations or []),
        "other_display_name": _name(db, other.id) if other else "Member",
        "version": plan.version,
        "history": [{k: v for k, v in h.items() if k != "idempotency_key"} for h in plan.history],
        "cancellation_rules": "Cancel at least 3 hours before. Repeated no-shows are reviewed under the community agreement.",
        "calendar_title": "Coffee plan",
        "check_in": {"state": checkin.state, "share_scope": checkin.share_scope, "check_at": iso(checkin.check_at), "trusted_contact_name": checkin.trusted_contact_name, "expires_at": iso(checkin.expires_at)} if checkin else None,
        "feedback_submitted": fb is not None,
        "feedback_open": plan.status in ("confirmed", "completed", "no_show", "disputed") and bool(plan.starts_at and plan.starts_at <= utcnow()),
        "safety": {"emergency": "112 (EU)", "guidance": ["Meet in the public venue you both confirmed.", "Tell a trusted contact.", "Arrange your own way home."]},
    }


def list_for(db: Session, viewer: Member) -> list[dict[str, Any]]:
    rows = db.execute(select(DatePlan).where(or_(DatePlan.member_a_id == viewer.id, DatePlan.member_b_id == viewer.id)).order_by(DatePlan.starts_at.desc().nullslast(), DatePlan.created_at.desc())).scalars().all()
    return [plan_payload(db, p, viewer) for p in rows]


def suggest_for_draft(db: Session, conv: Conversation, member: Member) -> tuple[str | None, str | None]:
    ov = overlaps(db, conv.member_a_id, conv.member_b_id, member.timezone)
    plan = create_plan(db, conv.id, member)
    venues = venue_shortlist(db, plan, member, "coffee") or venue_shortlist(db, plan, member)
    venue = venues[0]["name"] if venues else None
    window = f"{ov[0]['weekday']} around {ov[0]['start']}" if ov else None
    return venue, window


def _name(db: Session, member_id: str) -> str:
    p = db.get(Profile, member_id)
    return (p.display_name if p and p.display_name else "Your match")
