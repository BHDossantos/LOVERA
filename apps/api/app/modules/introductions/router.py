from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.db import get_db
from app.core.deps import Principal, active_member
from app.modules.introductions import service

router = APIRouter(prefix="/introductions", tags=["introductions"])


class DecisionIn(BaseModel):
    decision: str
    reason_codes: list[str] = []
    learning_consent: bool = False


class CorrectionIn(BaseModel):
    signal_key: str
    value: str | None = None
    note: str | None = Field(default=None, max_length=300)


class ViewIn(BaseModel):
    sections: list[str] = []


@router.get("")
def list_introductions(principal: Principal = Depends(active_member), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.list_for(db, principal.member)


@router.get("/waiting")
def waiting(principal: Principal = Depends(active_member), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.waiting_payload(db, principal.member)


@router.get("/{intro_id}")
def get_introduction(intro_id: str, principal: Principal = Depends(active_member), db: Session = Depends(get_db, scope="function")) -> dict:
    service.expire_due(db)
    intro = service.get_intro(db, intro_id, principal.id)
    track(db, "introduction_opened", principal.id, intro_id=intro.id, latency_bucket="<1d")
    return service.payload(db, intro, principal.member)


@router.post("/{intro_id}/explanation-viewed", status_code=204)
def explanation_viewed(intro_id: str, data: ViewIn, principal: Principal = Depends(active_member), db: Session = Depends(get_db, scope="function")) -> None:
    service.get_intro(db, intro_id, principal.id)
    track(db, "explanation_viewed", principal.id, intro_id=intro_id, sections=data.sections[:3])


@router.post("/{intro_id}/decision", status_code=202)
def decide(intro_id: str, data: DecisionIn, principal: Principal = Depends(active_member), db: Session = Depends(get_db, scope="function"), idempotency_key: str | None = Header(default=None), if_match: str | None = Header(default=None)) -> dict:
    return service.decide(db, intro_id, principal.member, data.decision, data.reason_codes, data.learning_consent, idempotency_key, if_match)


@router.post("/{intro_id}/extend")
def extend(intro_id: str, principal: Principal = Depends(active_member), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.extend(db, intro_id, principal.member)


@router.post("/{intro_id}/correction")
def correction(intro_id: str, data: CorrectionIn, principal: Principal = Depends(active_member), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.correct(db, intro_id, principal.member, data.signal_key, data.value, data.note)
