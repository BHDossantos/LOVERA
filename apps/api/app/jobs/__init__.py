"""Background jobs and outbox handlers. Idempotent; safe to replay."""
from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import events
from app.core.timeutil import utcnow
from app.models.privacy import OutboxEvent

log = logging.getLogger("jobs")


def _on_introduction_mutual(db: Session, event: OutboxEvent) -> None:
    log.info("mutual introduction %s -> conversation %s", event.aggregate_id, event.payload.get("conversation_id"))


def _on_blueprint_confirmed(db: Session, event: OutboxEvent) -> None:
    log.info("blueprint confirmed for %s", event.aggregate_id)


def register_handlers() -> None:
    events.subscribe("introduction.mutual", _on_introduction_mutual)
    events.subscribe("blueprint.confirmed", _on_blueprint_confirmed)


def expire_introductions(db: Session) -> int:
    from app.modules.introductions.service import expire_due

    return expire_due(db)


def send_date_reminders(db: Session) -> int:
    from app.models.dates import DatePlan
    from app.modules.notifications.service import notify

    now = utcnow()
    count = 0
    for plan in db.execute(select(DatePlan).where(DatePlan.status == "confirmed", DatePlan.starts_at > now, DatePlan.starts_at <= now + timedelta(hours=24))).scalars():
        for mid in (plan.member_a_id, plan.member_b_id):
            if notify(db, mid, "date_reminder", "dates", "Your date is within 24 hours", f"{plan.venue_snapshot.get('name', 'Public venue')}. Confirm you're still on, and set a check-in if you'd like.", f"/dates/{plan.id}", dedupe_key=f"reminder24:{plan.id}:{mid}"):
                count += 1
    return count


def missed_checkins(db: Session) -> int:
    from app.models.dates import DateCheckIn
    from app.modules.notifications.service import notify

    now = utcnow()
    count = 0
    for ci in db.execute(select(DateCheckIn).where(DateCheckIn.state == "scheduled", DateCheckIn.check_at <= now - timedelta(minutes=30))).scalars():
        ci.state = "missed"
        notify(db, ci.member_id, "checkin_missed", "safety", "We didn't get your check-in", "Tap to confirm you're okay. If you chose escalation, your trusted contact is being reached on your chosen channel.", f"/dates/{ci.date_plan_id}/safety", dedupe_key=f"missed:{ci.id}")
        count += 1
    return count


def retention_sweep(db: Session) -> dict[str, int]:
    from app.models.account import Member
    from app.models.dates import DateCheckIn
    from app.models.privacy import IdempotencyRecord, PrivacyRequest

    now = utcnow()
    stats = {"idempotency": 0, "location": 0, "exports": 0, "deletions": 0}
    for rec in db.execute(select(IdempotencyRecord).where(IdempotencyRecord.expires_at <= now)).scalars():
        db.delete(rec)
        stats["idempotency"] += 1
    for ci in db.execute(select(DateCheckIn).where(DateCheckIn.expires_at <= now, DateCheckIn.encrypted_location_ref.is_not(None))).scalars():
        ci.encrypted_location_ref = None
        stats["location"] += 1
    for req in db.execute(select(PrivacyRequest).where(PrivacyRequest.type == "export", PrivacyRequest.expires_at <= now, PrivacyRequest.status != "expired")).scalars():
        req.status = "expired"
        stats["exports"] += 1
    for m in db.execute(select(Member).where(Member.status == "deletion_pending", Member.deletion_due_at <= now)).scalars():
        erase_member(db, m)
        stats["deletions"] += 1
    return stats


def erase_member(db: Session, member) -> None:
    """Dependency ordered erasure with a tombstone. Safety records under legal hold are preserved by design."""
    from app.models.availability import AvailabilityVersion
    from app.models.blueprint import BlueprintSession, BlueprintVersion, Preference
    from app.models.conversations import Message
    from app.models.notifications import Notification
    from app.models.profile import Profile, ProfileMedia
    from app.models.account import Session as MemberSession

    for m in db.execute(select(Message).where(Message.sender_id == member.id)).scalars():
        m.body = "[deleted]"
        m.deleted_at = utcnow()
    for media in db.execute(select(ProfileMedia).where(ProfileMedia.member_id == member.id)).scalars():
        media.deleted_at = utcnow()
    profile = db.get(Profile, member.id)
    if profile:
        profile.display_name, profile.bio, profile.prompts, profile.occupation, profile.education, profile.pronouns = "Deleted member", None, [], None, None, None
    for model in (Preference, AvailabilityVersion, BlueprintSession, Notification):
        for row in db.execute(select(model).where(model.member_id == member.id)).scalars():
            db.delete(row)
    for v in db.execute(select(BlueprintVersion).where(BlueprintVersion.member_id == member.id)).scalars():
        db.delete(v)
    for s in db.execute(select(MemberSession).where(MemberSession.member_id == member.id)).scalars():
        s.revoked_at = utcnow()
    member.email = f"deleted+{member.id}@tombstone.invalid"
    member.email_hash = f"deleted:{member.id}"
    member.status = "deleted"
    member.deleted_at = utcnow()
    member.birth_date = None
    member.gender, member.seeking, member.home_zone_id = None, [], None
    from app.core.audit import audit

    audit(db, actor_type="system", actor_id=None, action="account.erased", resource_type="member", resource_id=member.id)


def run_all(db: Session) -> dict:
    return {"expired": expire_introductions(db), "reminders": send_date_reminders(db), "missed_checkins": missed_checkins(db), "retention": retention_sweep(db), "outbox": events.drain(db)}


def maybe_run_weekly_batch(db: Session) -> dict | None:
    """Run the market's weekly batch once per cohort date when the scheduled hour has passed."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from app.core.config import get_settings
    from app.models.matching import MatchRun
    from app.modules.matching.service import run_batch, run_payload

    settings = get_settings()
    now_local = datetime.now(ZoneInfo(settings.market_timezone))
    if now_local.weekday() != settings.match_batch_weekday or now_local.hour < settings.match_batch_hour:
        return None
    cohort_date = now_local.date().isoformat()
    exists = db.execute(select(MatchRun.id).where(MatchRun.market_id == settings.market_id, MatchRun.cohort_date == cohort_date)).first()
    if exists:
        return None
    run = run_batch(db, settings.market_id, auto_publish=settings.match_auto_publish)
    log.info("weekly batch %s status=%s allocated=%s", run.id, run.status, run.allocation_count)
    return run_payload(run)


def loop() -> None:
    """Long-running worker: ticks jobs, drains the outbox and runs the weekly batch on schedule."""
    import time

    from app.core.config import get_settings
    from app.core.db import session_factory

    settings = get_settings()
    log.info("worker started tick=%ss batch=weekday %s at %s:00 %s", settings.job_tick_seconds, settings.match_batch_weekday, settings.match_batch_hour, settings.market_timezone)
    while True:
        db = session_factory()()
        try:
            stats = run_all(db)
            batch = maybe_run_weekly_batch(db)
            db.commit()
            if any(v for k, v in stats.items() if k != "retention") or batch:
                log.info("tick %s batch=%s", stats, batch and batch["id"])
        except Exception:  # noqa: BLE001
            db.rollback()
            log.exception("worker tick failed")
        finally:
            db.close()
        time.sleep(settings.job_tick_seconds)
