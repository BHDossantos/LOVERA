"""Privacy rights without contacting support: matching-data map, export, pause, deletion."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.audit import audit
from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.core.timeutil import iso, utcnow
from app.models.account import ConsentRecord
from app.models.availability import AvailabilityVersion
from app.models.blueprint import BlueprintSignal, BlueprintVersion, Preference
from app.models.conversations import Conversation, Message
from app.models.dates import DatePlan, PostDateFeedback
from app.models.introductions import IntroDecision, Introduction
from app.models.privacy import PrivacyRequest
from app.models.profile import Profile
from app.modules.profile.service import VISIBILITY

router = APIRouter(prefix="/me", tags=["privacy"])


def build_export(db: Session, member_id: str) -> dict[str, Any]:
    profile = db.get(Profile, member_id)
    versions = db.execute(select(BlueprintVersion).where(BlueprintVersion.member_id == member_id)).scalars().all()
    signals = []
    for v in versions:
        for s in db.execute(select(BlueprintSignal).where(BlueprintSignal.blueprint_version_id == v.id)).scalars():
            signals.append({"version": v.version_no, "key": s.key, "value": s.normalized_value, "confidence": s.confidence, "corrected": s.member_corrected})
    prefs = [{"key": p.key, "tier": p.tier, "value": p.value} for p in db.execute(select(Preference).where(Preference.member_id == member_id)).scalars()]
    consents = [{"purpose": c.purpose, "status": c.status, "version": c.policy_version, "at": iso(c.granted_at or c.revoked_at)} for c in db.execute(select(ConsentRecord).where(ConsentRecord.member_id == member_id)).scalars()]
    intros = [{"id": i.id, "status": i.status, "offered_at": iso(i.offered_at)} for i in db.execute(select(Introduction).where(or_(Introduction.member_a_id == member_id, Introduction.member_b_id == member_id))).scalars()]
    decisions = [{"introduction_id": d.introduction_id, "decision": d.decision, "at": iso(d.decided_at)} for d in db.execute(select(IntroDecision).where(IntroDecision.member_id == member_id)).scalars()]
    messages = [{"conversation_id": m.conversation_id, "text": m.body, "sent_at": iso(m.sent_at)} for m in db.execute(select(Message).where(Message.sender_id == member_id)).scalars()]
    feedback = [{"date_plan_id": f.date_plan_id, "attendance": f.attendance, "second_date_answer": f.second_date_answer, "submitted_at": iso(f.submitted_at)} for f in db.execute(select(PostDateFeedback).where(PostDateFeedback.member_id == member_id)).scalars()]
    availability = db.execute(select(AvailabilityVersion).where(AvailabilityVersion.member_id == member_id).order_by(AvailabilityVersion.created_at.desc())).scalars().first()
    return {
        "generated_at": iso(utcnow()),
        "profile": {"display_name": profile.display_name, "bio": profile.bio, "languages": profile.languages, "prompts": profile.prompts} if profile else None,
        "blueprint_signals": signals,
        "preferences": prefs,
        "availability": availability.recurring_windows if availability else [],
        "consents": consents,
        "introductions": intros,
        "your_decisions": decisions,
        "your_messages": messages,
        "your_feedback": feedback,
        "note": "Other members' decisions, messages they wrote, reports and internal scores are not part of your export.",
    }


@router.get("/privacy")
def privacy_overview(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    from app.modules.account.service import current_consents

    requests = db.execute(select(PrivacyRequest).where(PrivacyRequest.member_id == principal.id).order_by(PrivacyRequest.requested_at.desc()).limit(10)).scalars().all()
    return {
        "visibility_map": VISIBILITY,
        "matching_data": ["Confirmed Blueprint signals", "Must / Prefer / Open preferences", "Coarse zone and distance", "Availability windows", "Your private post-date answers (never shown to anyone)"],
        "never_in_matching": ["Identity documents and biometrics", "Precise location", "Safety reports and evidence", "Appeal statements", "Private message text"],
        "consents": current_consents(db, principal.id),
        "status": principal.member.status,
        "deletion_due_at": iso(principal.member.deletion_due_at),
        "requests": [{"id": r.id, "type": r.type, "status": r.status, "requested_at": iso(r.requested_at), "expires_at": iso(r.expires_at)} for r in requests],
    }


@router.post("/export", status_code=202)
def export(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    req = PrivacyRequest(member_id=principal.id, type="export", status="ready", expires_at=utcnow() + timedelta(days=7), completed_at=utcnow())
    db.add(req)
    db.flush()
    track(db, "data_right_exercised", principal.id, type="export")
    audit(db, actor_type="member", actor_id=principal.id, action="privacy.export_requested", resource_type="privacy_request", resource_id=req.id)
    return {"request_id": req.id, "status": "ready", "download_path": f"/v1/me/export/{req.id}", "expires_at": iso(req.expires_at)}


@router.get("/export/{request_id}")
def download_export(request_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    req = db.get(PrivacyRequest, request_id)
    if req is None or req.member_id != principal.id or req.type != "export":
        raise ApiError("NOT_FOUND")
    if req.expires_at and req.expires_at <= utcnow():
        raise ApiError("CONFLICT", "This export link expired. Request a new one.")
    audit(db, actor_type="member", actor_id=principal.id, action="privacy.export_downloaded", resource_type="privacy_request", resource_id=req.id)
    return build_export(db, principal.id)
