from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.core.security import sign_webhook
from app.core.timeutil import utcnow
from app.modules.billing import service

router = APIRouter(tags=["billing"])


class CheckoutIn(BaseModel):
    plan: str
    # Defaulted, so a client written before annual existed still buys the thing it meant to buy.
    cadence: str = "monthly"


class CancelIn(BaseModel):
    reason: str | None = None


class SandboxPayIn(BaseModel):
    checkout_ref: str
    outcome: str = "paid"


@router.get("/plans")
def plans() -> dict:
    return service.plans_payload()


@router.post("/subscriptions/checkout")
def checkout(data: CheckoutIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function"), idempotency_key: str | None = Header(default=None)) -> dict:
    return service.create_checkout(db, principal.member, data.plan, idempotency_key, data.cadence)


@router.get("/subscriptions/checkout/{provider_ref}")
def checkout_detail(provider_ref: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    """What this checkout is actually for.

    The hosted checkout page had no way to ask, so it rendered Pro at the monthly price whatever
    had been started — meaning somebody buying Concierge annually was shown "Matchmaker Pro,
    EUR 39 / month" on the page where they confirm the charge. A payment screen that names the
    wrong product and the wrong amount is the one screen that must never be approximated.
    """
    return service.checkout_detail(db, principal.member, provider_ref)


@router.get("/subscriptions/current")
def current(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return {"entitlements": service.entitlements_for(db, principal.member), "ledger": service.ledger(db, principal.id)}


@router.post("/subscriptions/cancel")
def cancel(data: CancelIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return {"entitlements": service.cancel(db, principal.member, data.reason)}


@router.post("/subscriptions/sandbox/pay")
def sandbox_pay(data: SandboxPayIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    settings = get_settings()
    if settings.is_production or settings.payments_provider != "sandbox":
        raise ApiError("NOT_FOUND")
    event_type = "checkout.session.completed" if data.outcome == "paid" else "invoice.payment_failed"
    body = json.dumps({"id": f"evt_{data.checkout_ref}_{data.outcome}", "type": event_type, "data": {"checkout_ref": data.checkout_ref, "subscription_ref": f"sub_{data.checkout_ref}"}}).encode()
    ts = str(int(utcnow().timestamp()))
    service.handle_payment_webhook(db, body, ts, sign_webhook(settings.payments_webhook_secret, body, ts))
    return {"entitlements": service.entitlements_for(db, principal.member)}


@router.post("/webhooks/payments")
async def payments_webhook(request: Request, db: Session = Depends(get_db, scope="function"), x_vendor_timestamp: str = Header(default=""), x_vendor_signature: str = Header(default="")) -> dict:
    body = await request.body()
    return service.handle_payment_webhook(db, body, x_vendor_timestamp, x_vendor_signature)
