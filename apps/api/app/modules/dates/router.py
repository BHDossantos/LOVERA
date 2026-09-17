from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.modules.billing.service import entitlements_for
from app.modules.dates import service

router = APIRouter(prefix="/date-plans", tags=["dates"])


class CreateIn(BaseModel):
    conversation_id: str


class ProposeIn(BaseModel):
    starts_at: datetime
    duration_minutes: int = 120
    venue_id: str
    date_style: str | None = None


class RespondIn(BaseModel):
    action: str = Field(pattern="^(accept|decline)$")


class CancelIn(BaseModel):
    reason: str = "other"


class CheckInConfigIn(BaseModel):
    trusted_contact_name: str = Field(min_length=1, max_length=80)
    trusted_contact_channel: str = Field(min_length=3, max_length=120)
    share_scope: str = "plan_and_checkin"
    check_at: datetime | None = None
    escalation_preference: str = Field(default="contact", pattern="^(contact|contact_and_support)$")


class CheckInNowIn(BaseModel):
    state: str = Field(pattern="^(checked_in|escalated)$")
    location_note: str | None = Field(default=None, max_length=200)


class FeedbackIn(BaseModel):
    attendance: str
    felt_safe: bool | None = None
    enjoyed: str | None = Field(default=None, pattern="^(yes|somewhat|no)$")
    second_date_answer: str | None = None
    fit_reasons: list[str] = []
    safety_flag: bool = False
    learning_consent: bool = False


@router.get("")
def list_plans(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return {"items": service.list_for(db, principal.member)}


@router.post("", status_code=201)
def create(data: CreateIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    plan = service.create_plan(db, data.conversation_id, principal.member)
    return service.plan_payload(db, plan, principal.member)


@router.get("/{plan_id}")
def get_plan(plan_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.plan_payload(db, service.get_plan(db, plan_id, principal.id), principal.member)


@router.get("/{plan_id}/overlaps")
def get_overlaps(plan_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    plan = service.get_plan(db, plan_id, principal.id)
    ent = entitlements_for(db, principal.member)
    windows = service.overlaps(db, plan.member_a_id, plan.member_b_id, plan.timezone)
    return {"items": windows if ent["date_concierge"] else windows[:3], "concierge": ent["date_concierge"], "note": "Only overlapping coarse windows are shown. Nobody sees the other person's full availability."}


@router.get("/{plan_id}/venues")
def get_venues(plan_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function"), style: str | None = None) -> dict:
    plan = service.get_plan(db, plan_id, principal.id)
    ent = entitlements_for(db, principal.member)
    items = service.venue_shortlist(db, plan, principal.member, style)
    return {"items": items if ent["date_concierge"] else items[:1], "concierge": ent["date_concierge"], "rules": ["Public places only for a first date.", "Travel is balanced using both members' coarse zones, never exact addresses.", "Private residences are excluded."]}


@router.post("/{plan_id}/proposals")
def propose(plan_id: str, data: ProposeIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function"), if_match: str | None = Header(default=None), idempotency_key: str | None = Header(default=None)) -> dict:
    plan = service.propose(db, plan_id, principal.member, data.starts_at, data.duration_minutes, data.venue_id, data.date_style, if_match, idempotency_key)
    return service.plan_payload(db, plan, principal.member)


@router.post("/{plan_id}/respond")
def respond(plan_id: str, data: RespondIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function"), if_match: str | None = Header(default=None)) -> dict:
    plan = service.respond(db, plan_id, principal.member, data.action, if_match)
    return service.plan_payload(db, plan, principal.member)


@router.post("/{plan_id}/cancel")
def cancel(plan_id: str, data: CancelIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    plan = service.cancel(db, plan_id, principal.member, data.reason)
    return service.plan_payload(db, plan, principal.member)


@router.post("/{plan_id}/check-in")
def configure_checkin(plan_id: str, data: CheckInConfigIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.configure_checkin(db, plan_id, principal.member, data.trusted_contact_name, data.trusted_contact_channel, data.share_scope, data.check_at, data.escalation_preference)
    return service.plan_payload(db, service.get_plan(db, plan_id, principal.id), principal.member)


@router.post("/{plan_id}/check-in/now")
def checkin_now(plan_id: str, data: CheckInNowIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.checkin_now(db, plan_id, principal.member, data.state, data.location_note)
    return service.plan_payload(db, service.get_plan(db, plan_id, principal.id), principal.member)


@router.post("/{plan_id}/feedback")
def feedback(plan_id: str, data: FeedbackIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.submit_feedback(db, plan_id, principal.member, data.attendance, data.felt_safe, data.enjoyed, data.second_date_answer, data.fit_reasons, data.safety_flag, data.learning_consent)
    return {"saved": True, "privacy": "Your answers are private. Only a mutual yes is ever revealed.", "outcome": service.mutual_outcome(db, plan_id, principal.member)}


@router.get("/{plan_id}/mutual-outcome")
def mutual_outcome(plan_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.mutual_outcome(db, plan_id, principal.member)
