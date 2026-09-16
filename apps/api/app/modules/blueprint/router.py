from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.models.blueprint import BlueprintSession, Preference
from app.modules.blueprint import service

router = APIRouter(tags=["blueprint"])


class SessionStartIn(BaseModel):
    mode: str = Field(default="initial", pattern="^(initial|refresh)$")


class AnswerIn(BaseModel):
    question_key: str
    choice: str | None = None
    text: str | None = Field(default=None, max_length=1500)
    tier: str | None = None
    partner_values: list[str] | None = None
    range: dict[str, Any] | None = None
    skip: bool = False
    input_mode: str = Field(default="choice", pattern="^(choice|text|voice)$")


class ConfirmIn(BaseModel):
    session_id: str
    signal_edits: list[dict[str, Any]] = []
    preference_edits: list[dict[str, Any]] = []
    removed_signal_keys: list[str] = []


class PreferenceIn(BaseModel):
    tier: str
    value: dict[str, Any]


class ImpactIn(BaseModel):
    key: str
    tier: str
    value: dict[str, Any]


def _session(db: Session, principal: Principal, session_id: str) -> BlueprintSession:
    s = db.get(BlueprintSession, session_id)
    if s is None or s.member_id != principal.id:
        raise ApiError("NOT_FOUND")
    return s


@router.post("/blueprint/sessions")
def start_session(data: SessionStartIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    if data.mode == "refresh":
        from app.modules.billing.service import entitlements_for

        if not entitlements_for(db, principal.member)["adaptive_refresh"]:
            raise ApiError("FORBIDDEN", "Adaptive refresh is part of Matchmaker Pro. You can still edit every signal for free.", extra={"capability": "adaptive_refresh"})
    session = service.get_or_create_session(db, principal.member, data.mode)
    return service.session_payload(db, session, principal.member)


@router.get("/blueprint/sessions/{session_id}")
def get_session(session_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return service.session_payload(db, _session(db, principal, session_id), principal.member)


@router.post("/blueprint/sessions/{session_id}/answers")
def answer(session_id: str, data: AnswerIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    session = _session(db, principal, session_id)
    return service.answer(db, principal.member, session, data.question_key, data.choice, data.text, data.tier, data.partner_values, data.range, data.skip, data.input_mode)


@router.post("/blueprint/sessions/{session_id}/finish")
def finish(session_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return service.finish_interview(db, principal.member, _session(db, principal, session_id))


@router.get("/blueprint/sessions/{session_id}/review")
def review(session_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return service.review_payload(db, principal.member, _session(db, principal, session_id))


@router.post("/blueprint/confirm")
def confirm(data: ConfirmIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    session = _session(db, principal, data.session_id)
    version = service.confirm(db, principal.member, session, data.signal_edits, data.preference_edits, data.removed_signal_keys)
    return {"version_id": version.id, "version_no": version.version_no, "blueprint": service.current_payload(db, principal.member), "onboarding_step": principal.member.onboarding_step}


@router.get("/blueprint/current")
def current(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return service.current_payload(db, principal.member)


@router.post("/blueprint/signals/{key}")
def correct_signal(key: str, data: PreferenceIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    """Member correction of a confirmed signal. Creates a new confirmed version (matching recalculates after save)."""
    from sqlalchemy import select

    from app.catalog.signals import SIGNALS
    from app.core.audit import audit
    from app.core.timeutil import utcnow
    from app.models.blueprint import BlueprintSignal, BlueprintVersion

    if key not in SIGNALS or data.value.get("value") not in SIGNALS[key].options:
        raise ApiError("VALIDATION_ERROR", "Unknown signal or value.")
    current_version = db.execute(select(BlueprintVersion).where(BlueprintVersion.member_id == principal.id, BlueprintVersion.status == "confirmed")).scalar_one_or_none()
    if current_version is None:
        raise ApiError("CONFLICT", "Confirm a Blueprint first.")
    signals = db.execute(select(BlueprintSignal).where(BlueprintSignal.blueprint_version_id == current_version.id)).scalars().all()
    current_version.status = "superseded"
    new_version = BlueprintVersion(member_id=principal.id, version_no=current_version.version_no + 1, status="confirmed", source_session_id=current_version.source_session_id, model_version=current_version.model_version, confirmed_at=utcnow())
    db.add(new_version)
    db.flush()
    seen = False
    for s in signals:
        if s.key == key:
            seen = True
            db.add(BlueprintSignal(blueprint_version_id=new_version.id, category=s.category, key=key, normalized_value={"value": data.value["value"]}, confidence="strong", evidence_refs=[{"text": "Corrected by you."}], member_corrected=True, freshness_at=utcnow()))
        else:
            db.add(BlueprintSignal(blueprint_version_id=new_version.id, category=s.category, key=s.key, normalized_value=s.normalized_value, confidence=s.confidence, evidence_refs=s.evidence_refs, member_corrected=s.member_corrected, freshness_at=s.freshness_at))
    if not seen:
        db.add(BlueprintSignal(blueprint_version_id=new_version.id, category=SIGNALS[key].category, key=key, normalized_value={"value": data.value["value"]}, confidence="strong", evidence_refs=[{"text": "Added by you."}], member_corrected=True, freshness_at=utcnow()))
    audit(db, actor_type="member", actor_id=principal.id, action="blueprint.signal_corrected", resource_type="blueprint_version", resource_id=new_version.id, metadata={"key": key})
    return service.current_payload(db, principal.member)


@router.get("/preferences")
def list_preferences(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return service.preferences_payload(db, principal.member)


@router.patch("/preferences/{key}")
def patch_preference(key: str, data: PreferenceIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    from app.core.audit import audit

    service.upsert_preference(db, principal.member, key, data.tier, data.value)
    audit(db, actor_type="member", actor_id=principal.id, action="preference.updated", resource_type="preference", resource_id=key, metadata={"tier": data.tier})
    return service.preferences_payload(db, principal.member)


@router.delete("/preferences/{key}", status_code=204)
def delete_preference(key: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> None:
    from sqlalchemy import select

    if key in ("age_range", "distance_km", "children", "relationship_structure"):
        raise ApiError("CONFLICT", "Core eligibility preferences cannot be removed; set them to Open instead.")
    pref = db.execute(select(Preference).where(Preference.member_id == principal.id, Preference.key == key)).scalar_one_or_none()
    if pref:
        db.delete(pref)


@router.post("/preferences/impact-preview")
def impact(data: ImpactIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    if data.key not in service.PREFERENCES:
        raise ApiError("VALIDATION_ERROR", "Unknown preference.")
    return service.impact_preview(db, principal.member, data.key, data.tier, data.value)
