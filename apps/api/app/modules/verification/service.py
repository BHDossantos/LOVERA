"""Identity and liveness verification. The platform stores a normalized result and a vendor token, never documents."""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.audit import audit
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import verify_webhook
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.billing import WebhookReceipt
from app.models.verification import Verification


def start_session(db: Session, member: Member) -> dict[str, Any]:
    settings = get_settings()
    existing = db.execute(select(Verification).where(Verification.member_id == member.id, Verification.status.in_(("in_progress", "verified", "review_required"))).order_by(Verification.created_at.desc())).scalars().first()
    if existing and existing.status == "verified" and existing.expires_at and existing.expires_at > utcnow():
        return {"session": None, "status": "verified", "message": "You are already verified."}
    if existing and existing.status == "in_progress":
        v = existing
    else:
        v = Verification(member_id=member.id, provider=settings.identity_provider, provider_ref=f"ver_{secrets.token_urlsafe(12)}", status="in_progress")
        db.add(v)
        db.flush()
    track(db, "verification_started", member.id, vendor_type=settings.identity_provider, market=member.market_id)
    audit(db, actor_type="member", actor_id=member.id, action="verification.started", resource_type="verification", resource_id=v.id)
    # The vendor hosted flow is represented by a URL the web app opens. The sandbox provider renders a simulated capture page.
    return {
        "session": {"provider": v.provider, "provider_ref": v.provider_ref, "hosted_url": f"/onboarding/verification/vendor?ref={v.provider_ref}", "expires_at": iso(utcnow() + timedelta(hours=1))},
        "status": v.status,
        "collects": ["Government ID (checked by the vendor, not stored by us)", "Short liveness selfie video (deleted by the vendor after the check)"],
        "we_keep": ["A verified/not verified result", "Over-18 result", "A vendor reference token", "Verification date and expiry"],
        "alternate_path": "If automated checks fail you can request a human review from the Verification Center.",
    }


def status_payload(db: Session, member_id: str) -> dict[str, Any]:
    v = db.execute(select(Verification).where(Verification.member_id == member_id).order_by(Verification.created_at.desc())).scalars().first()
    if v is None:
        return {"status": "not_started", "verified_at": None, "expires_at": None, "age_over_18": None, "liveness_passed": None, "failure_reason_code": None, "badges": []}
    status = v.status
    if status == "verified" and v.expires_at and v.expires_at <= utcnow():
        status = "expired"
    badges = []
    if status == "verified":
        badges = [
            {"key": "identity", "label": "Identity checked", "limits": "Confirms a real government ID matched a live selfie at verification time. Not a background check and not a character guarantee."},
            {"key": "adult", "label": "18+", "limits": "Confirms the vendor found the member to be over 18."},
        ]
    return {
        "status": status,
        "verified_at": iso(v.verified_at),
        "expires_at": iso(v.expires_at),
        "age_over_18": v.age_over_18,
        "liveness_passed": v.liveness_passed,
        "failure_reason_code": v.failure_reason_code,
        "badges": badges,
    }


def apply_result(db: Session, provider_ref: str, result: dict[str, Any], source: str) -> Verification:
    v = db.execute(select(Verification).where(Verification.provider_ref == provider_ref)).scalar_one_or_none()
    if v is None:
        raise ApiError("NOT_FOUND", "Unknown verification reference.")
    if v.status == "verified":
        return v
    settings = get_settings()
    outcome = result.get("outcome")
    v.age_over_18 = bool(result.get("age_over_18"))
    v.liveness_passed = bool(result.get("liveness_passed"))
    v.country_code = (result.get("country_code") or "")[:2] or None
    if outcome == "verified" and v.age_over_18 and v.liveness_passed:
        v.status = "verified"
        v.verified_at = utcnow()
        v.expires_at = utcnow() + timedelta(days=settings.verification_validity_days)
        v.failure_reason_code = None
    elif outcome == "review":
        v.status = "review_required"
        v.failure_reason_code = result.get("reason_code") or "manual_review"
    else:
        v.status = "failed"
        v.failure_reason_code = result.get("reason_code") or ("under_18" if not v.age_over_18 else "no_match")
    member = db.get(Member, v.member_id)
    if member:
        if v.status == "failed" and v.failure_reason_code == "under_18":
            member.status = "restricted"
            member.risk_flags = {**(member.risk_flags or {}), "under_18_signal": True}
        else:
            from app.modules.account.service import advance_onboarding

            advance_onboarding(db, member)
        track(db, "verification_completed", member.id, status=v.status, duration_bucket="<1h")
    audit(db, actor_type="vendor" if source == "webhook" else "staff", actor_id=None, action=f"verification.{v.status}", resource_type="verification", resource_id=v.id, metadata={"reason": v.failure_reason_code})
    return v


def handle_webhook(db: Session, body: bytes, timestamp: str, signature: str) -> dict[str, Any]:
    settings = get_settings()
    if not verify_webhook(settings.identity_webhook_secret, body, timestamp, signature):
        raise ApiError("FORBIDDEN", "Invalid webhook signature.")
    payload = json.loads(body.decode("utf-8"))
    event_id = str(payload.get("event_id") or hashlib.sha256(body).hexdigest())
    existing = db.execute(select(WebhookReceipt).where(WebhookReceipt.provider == "identity", WebhookReceipt.provider_event_id == event_id)).scalar_one_or_none()
    if existing:
        return {"received": True, "duplicate": True}
    receipt = WebhookReceipt(provider="identity", provider_event_id=event_id, event_type=str(payload.get("type", "verification.completed")), body_hash=hashlib.sha256(body).hexdigest(), payload={"provider_ref": payload.get("provider_ref")})
    db.add(receipt)
    db.flush()
    apply_result(db, payload["provider_ref"], payload.get("result", {}), source="webhook")
    receipt.status = "processed"
    receipt.processed_at = utcnow()
    return {"received": True, "duplicate": False}


def request_manual_review(db: Session, member: Member, note: str | None) -> dict[str, Any]:
    v = db.execute(select(Verification).where(Verification.member_id == member.id).order_by(Verification.created_at.desc())).scalars().first()
    if v is None or v.status == "verified":
        raise ApiError("CONFLICT", "There is no failed verification to review.")
    v.status = "review_required"
    v.review_note = (note or "")[:500]
    audit(db, actor_type="member", actor_id=member.id, action="verification.review_requested", resource_type="verification", resource_id=v.id)
    return status_payload(db, member.id)
