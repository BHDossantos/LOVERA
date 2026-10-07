from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.analytics import bucket, track
from app.core.audit import audit
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.events import publish
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.conversations import Conversation
from app.models.introductions import IntroCorrection, IntroDecision, Introduction, MatchExplanation
from app.modules.billing.service import entitlements_for
from app.modules.notifications.service import notify
from app.modules.profile.service import snapshot_for_viewer

DECLINE_REASONS = ("timing", "distance", "life_plan", "lifestyle", "no_spark", "prefer_not_to_say")


def get_intro(db: Session, intro_id: str, member_id: str) -> Introduction:
    intro = db.get(Introduction, intro_id)
    if intro is None or member_id not in intro.participants() or intro.status == "draft":
        raise ApiError("NOT_FOUND")
    return intro


def my_decision(db: Session, intro: Introduction, member_id: str) -> IntroDecision | None:
    return db.execute(select(IntroDecision).where(IntroDecision.introduction_id == intro.id, IntroDecision.member_id == member_id)).scalar_one_or_none()


def explanation_for(db: Session, intro: Introduction, member_id: str) -> dict[str, Any] | None:
    ex = db.execute(select(MatchExplanation).where(MatchExplanation.introduction_id == intro.id, MatchExplanation.for_member_id == member_id)).scalar_one_or_none()
    if ex is None:
        return None
    return {"reasons": ex.reasons, "friction": ex.friction, "unknown": ex.unknown, "data_categories": ex.data_categories, "generator_version": ex.generator_version, "reviewed": ex.reviewer_id is not None}


def public_status(intro: Introduction, mine: IntroDecision | None) -> str:
    """Status visible to one participant. Never reveals the other person's one-sided decision."""
    if intro.status == "mutual":
        return "mutual"
    if intro.status == "offered":
        return "awaiting_other_member" if mine else "offered"
    if intro.status in ("declined", "expired", "withdrawn", "closed"):
        if mine and mine.decision == "decline":
            return "you_passed"
        return "unavailable"  # neutral: expiry, decline by other, or withdrawal are indistinguishable
    return intro.status


def payload(db: Session, intro: Introduction, viewer: Member) -> dict[str, Any]:
    other = db.get(Member, intro.other(viewer.id))
    mine = my_decision(db, intro, viewer.id)
    status = public_status(intro, mine)
    now = utcnow()
    live = intro.status == "offered" and intro.expires_at and intro.expires_at > now
    ent = entitlements_for(db, viewer)
    is_trial = viewer.id in (intro.is_trial_for or [])
    out: dict[str, Any] = {
        "id": intro.id,
        "status": status,
        "offered_at": iso(intro.offered_at),
        "expires_at": iso(intro.expires_at),
        "extension_available": bool(live and viewer.id not in (intro.extension_used_by or []) and mine is None),
        "is_trial": is_trial,
        "your_decision": mine.decision if mine else None,
        "mutual_interest_revealed": intro.status == "mutual",
        "conversation_id": intro.conversation_id if intro.status == "mutual" else None,
        "version": intro.version,
        "actions": {"can_accept": bool(live and mine is None), "can_decline": bool(live and mine is None), "can_extend": bool(live and viewer.id not in (intro.extension_used_by or []) and mine is None), "can_correct": bool(live)},
        "privacy": "Your decision is private. A pass is never shown as a rating and does not affect your visibility.",
    }
    if status in ("offered", "awaiting_other_member", "mutual") and other is not None:
        out["profile"] = snapshot_for_viewer(db, other, viewer)
        out["explanation"] = explanation_for(db, intro, viewer.id)
    else:
        out["profile"] = None
        out["explanation"] = None
    return out


def list_for(db: Session, viewer: Member) -> dict[str, Any]:
    rows = db.execute(select(Introduction).where(or_(Introduction.member_a_id == viewer.id, Introduction.member_b_id == viewer.id), Introduction.status != "draft").order_by(Introduction.offered_at.desc())).scalars().all()
    expire_due(db)
    items = [payload(db, i, viewer) for i in rows]
    current = [i for i in items if i["status"] in ("offered", "awaiting_other_member")]
    mutual = [i for i in items if i["status"] == "mutual"]
    history = [i for i in items if i["status"] not in ("offered", "awaiting_other_member", "mutual")]
    return {"current": current, "mutual": mutual, "history": history, "waiting": waiting_payload(db, viewer) if not current else None}


def waiting_payload(db: Session, viewer: Member) -> dict[str, Any]:
    """I06: transparent explanation of why nothing is offered right now."""
    from app.modules.matching.eligibility import candidate_pool, passes_hard_gate
    from app.modules.matching.service import capacity_for

    ent = entitlements_for(db, viewer)
    pool = candidate_pool(db, viewer)
    eligible = sum(1 for other in pool if passes_hard_gate(db, viewer, other))
    cap = capacity_for(db, viewer)
    reasons = []
    if not ent["paid"] and ent["trial_introductions_remaining"] == 0:
        reasons.append({"code": "trial_used", "text": "You've used your trial introduction. Matchmaker Pro continues weekly curation."})
    if cap == 0 and ent["paid"]:
        reasons.append({"code": "capacity", "text": "You have as many open introductions or conversations as the pilot allows. Finish one first."})
    if eligible == 0:
        reasons.append({"code": "no_qualified_inventory", "text": "Nobody in the verified pool passes both sides' Must criteria right now. We did not relax any of yours."})
    elif eligible < 5:
        reasons.append({"code": "thin_inventory", "text": f"Only {eligible} verified members pass both sides' Must criteria. Introductions are scarce but not zero."})
    if not reasons:
        reasons.append({"code": "next_batch", "text": "You are in the next weekly batch. Introductions arrive once the concierge review is done."})
    return {"eligible_after_must": eligible, "verified_pool": len(pool), "capacity": cap, "reasons": reasons, "protected_credits": ent["protected_credits"], "next_batch": "weekly", "broaden_hint": "You can preview what a broader Prefer setting would change before saving anything. Must criteria are never lowered for you."}


def decide(db: Session, intro_id: str, member: Member, decision: str, reason_codes: list[str], learning_consent: bool, idempotency_key: str | None, if_match: str | None) -> dict[str, Any]:
    if decision not in ("accept", "decline"):
        raise ApiError("VALIDATION_ERROR", "Decision must be accept or decline.", field_errors={"decision": "invalid"})
    if idempotency_key:
        prior = db.execute(select(IntroDecision).where(IntroDecision.member_id == member.id, IntroDecision.idempotency_key == idempotency_key)).scalar_one_or_none()
        if prior is not None:
            if prior.introduction_id != intro_id or prior.decision != decision:
                raise ApiError("IDEMPOTENCY_CONFLICT")
            intro = db.get(Introduction, intro_id)
            return decision_payload(db, intro, member, prior)
    intro = db.execute(select(Introduction).where(Introduction.id == intro_id).with_for_update()).scalar_one_or_none()
    if intro is None or member.id not in intro.participants() or intro.status == "draft":
        raise ApiError("NOT_FOUND")
    if if_match and if_match.strip('"') != str(intro.version):
        raise ApiError("VERSION_MISMATCH", "This introduction changed. Reload before deciding.")
    existing = my_decision(db, intro, member.id)
    if existing:
        if existing.decision == decision:
            return decision_payload(db, intro, member, existing)
        raise ApiError("CONFLICT", "You already gave a decision on this introduction.")
    if intro.status != "offered" or not intro.expires_at or intro.expires_at <= utcnow():
        raise ApiError("CONFLICT", "This introduction is no longer open.")
    ent = entitlements_for(db, member)
    if not ent["paid"] and member.id not in (intro.is_trial_for or []):
        raise ApiError("FORBIDDEN", "Deciding on curated introductions is part of Matchmaker Pro.", extra={"capability": "introductions"})
    codes = [c for c in reason_codes if c in DECLINE_REASONS] if decision == "decline" else []
    rec = IntroDecision(introduction_id=intro.id, member_id=member.id, decision=decision, reason_codes=codes if learning_consent else [], learning_consent=learning_consent, idempotency_key=idempotency_key)
    db.add(rec)
    db.flush()
    latency = (utcnow() - intro.offered_at).total_seconds() if intro.offered_at else 0
    track(db, "intro_decision", member.id, intro_id=intro.id, decision=decision, reason_codes=codes if learning_consent else [], latency_bucket=bucket(latency))
    audit(db, actor_type="member", actor_id=member.id, action=f"introduction.{decision}", resource_type="introduction", resource_id=intro.id)
    other_id = intro.other(member.id)
    other_decision = my_decision(db, intro, other_id)
    if decision == "decline":
        intro.status = "declined"
        intro.closed_reason = "declined"
        intro.version += 1
        # The other member sees a neutral "unavailable" state; no notification names the decision source.
    elif other_decision and other_decision.decision == "accept":
        intro.status = "mutual"
        intro.version += 1
        conv = db.execute(select(Conversation).where(Conversation.introduction_id == intro.id)).scalar_one_or_none()
        if conv is None:
            conv = Conversation(introduction_id=intro.id, member_a_id=intro.member_a_id, member_b_id=intro.member_b_id, status="active")
            db.add(conv)
            db.flush()
        intro.conversation_id = conv.id
        lat_a = (other_decision.decided_at - intro.offered_at).total_seconds() if intro.offered_at else 0
        track(db, "mutual_accept", member.id, intro_id=intro.id, latency_bucket_a=bucket(lat_a), latency_bucket_b=bucket(latency))
        for mid in intro.participants():
            notify(db, mid, "mutual_accept", "introductions", "You both said yes", "Chat is open. Suggested openers are drafts; nothing is sent without you.", f"/introductions/{intro.id}/mutual", dedupe_key=f"mutual:{intro.id}:{mid}")
        publish(db, "introduction.mutual", "introduction", intro.id, {"conversation_id": conv.id, "members": list(intro.participants())}, dedupe_key=f"introduction.mutual:{intro.id}")
    else:
        intro.version += 1
    return decision_payload(db, intro, member, rec)


def decision_payload(db: Session, intro: Introduction, member: Member, rec: IntroDecision) -> dict[str, Any]:
    return {"introduction_id": intro.id, "your_decision": rec.decision, "status": public_status(intro, rec), "mutual_interest_revealed": intro.status == "mutual", "conversation_id": intro.conversation_id if intro.status == "mutual" else None, "version": intro.version}


def extend(db: Session, intro_id: str, member: Member) -> dict[str, Any]:
    settings = get_settings()
    intro = db.execute(select(Introduction).where(Introduction.id == intro_id).with_for_update()).scalar_one_or_none()
    if intro is None or member.id not in intro.participants():
        raise ApiError("NOT_FOUND")
    if intro.status != "offered" or not intro.expires_at or intro.expires_at <= utcnow():
        raise ApiError("CONFLICT", "This introduction can no longer be extended.")
    if member.id in (intro.extension_used_by or []):
        raise ApiError("CONFLICT", "You already used your one extension.")
    intro.expires_at = intro.expires_at + timedelta(hours=settings.introduction_extension_hours)
    intro.extension_used_by = [*(intro.extension_used_by or []), member.id]
    intro.version += 1
    audit(db, actor_type="member", actor_id=member.id, action="introduction.extended", resource_type="introduction", resource_id=intro.id)
    return payload(db, intro, member)


def correct(db: Session, intro_id: str, member: Member, signal_key: str, value: str | None, note: str | None) -> dict[str, Any]:
    from app.catalog.signals import SIGNALS

    intro = get_intro(db, intro_id, member.id)
    if signal_key not in SIGNALS:
        raise ApiError("VALIDATION_ERROR", "Unknown signal.", field_errors={"signal_key": "unknown"})
    db.add(IntroCorrection(introduction_id=intro.id, member_id=member.id, signal_key=signal_key, corrected_value={"value": value}, note=(note or "")[:300] or None))
    applied = bool(value)
    if applied:
        from app.modules.blueprint.router import PreferenceIn, correct_signal  # reuse the versioned correction path

        from app.core.deps import Principal

        correct_signal(signal_key, PreferenceIn(tier="open", value={"value": value}), Principal(member=member, session_id="", roles=list(member.roles or []), request_id=""), db)
    audit(db, actor_type="member", actor_id=member.id, action="introduction.correction", resource_type="introduction", resource_id=intro.id, metadata={"signal_key": signal_key})
    # Without a replacement value nothing about matching changes: the IntroCorrection row is
    # read by nothing, and correct_signal is skipped, so the signal the member says is wrong
    # stays live. Saying "your Blueprint is updated" either way told them their own data had
    # been fixed when it had not — the one claim this product cannot afford to get wrong.
    return {
        "recorded": True,
        "applied": applied,
        "message": (
            "Thanks. Your Blueprint is updated and future introductions use the corrected value."
            if applied
            else "Noted for a reviewer. Your matching has not changed, because you didn't pick a replacement value — choose one if you want future introductions to use it."
        ),
    }


def expire_due(db: Session) -> int:
    now = utcnow()
    rows = db.execute(select(Introduction).where(Introduction.status == "offered", Introduction.expires_at <= now)).scalars().all()
    for intro in rows:
        intro.status = "expired"
        intro.closed_reason = "expired"
        intro.version += 1
        for mid in intro.participants():
            if my_decision(db, intro, mid) is None:
                notify(db, mid, "introduction_expired", "introductions", "An introduction closed", "The review window ended. Nothing about your choice was shared.", "/introductions", dedupe_key=f"intro_expired:{intro.id}:{mid}")
    return len(rows)
