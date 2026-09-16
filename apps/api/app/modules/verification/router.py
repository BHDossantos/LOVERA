from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.core.security import sign_webhook
from app.core.timeutil import utcnow
from app.modules.verification import service

router = APIRouter(tags=["verification"])


class ReviewIn(BaseModel):
    note: str | None = None


class SandboxCompleteIn(BaseModel):
    provider_ref: str
    outcome: str = "verified"  # verified | failed | review
    age_over_18: bool = True
    liveness_passed: bool = True
    reason_code: str | None = None


@router.post("/verification/sessions")
def create_session(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    if principal.member.birth_date is None:
        raise ApiError("ONBOARDING_INCOMPLETE", "Confirm adult eligibility first.", extra={"onboarding_step": "account"})
    return service.start_session(db, principal.member)


@router.get("/verification/status")
def status(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return service.status_payload(db, principal.id)


@router.post("/verification/review-request")
def review_request(data: ReviewIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return service.request_manual_review(db, principal.member, data.note)


@router.post("/verification/sandbox/complete")
def sandbox_complete(data: SandboxCompleteIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    """Sandbox vendor: simulates the hosted capture flow finishing, then delivers a signed webhook to ourselves."""
    settings = get_settings()
    if settings.is_production or settings.identity_provider != "sandbox":
        raise ApiError("NOT_FOUND")
    import json

    body = json.dumps({"event_id": f"evt_{data.provider_ref}_{data.outcome}", "type": "verification.completed", "provider_ref": data.provider_ref, "result": data.model_dump()}).encode()
    ts = str(int(utcnow().timestamp()))
    service.handle_webhook(db, body, ts, sign_webhook(settings.identity_webhook_secret, body, ts))
    return service.status_payload(db, principal.id)


@router.post("/webhooks/verification")
async def verification_webhook(request: Request, db: Session = Depends(get_db), x_vendor_timestamp: str = Header(default=""), x_vendor_signature: str = Header(default="")) -> dict:
    body = await request.body()
    return service.handle_webhook(db, body, x_vendor_timestamp, x_vendor_signature)

