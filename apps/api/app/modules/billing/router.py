from __future__ import annotations

import json
import secrets

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


class StorePurchaseIn(BaseModel):
    store: str
    product_id: str
    transaction_id: str


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
    if get_settings().store_validation == "revenuecat":
        from app.modules.billing.revenuecat import sync
        sync(db, principal.member)
    return {"entitlements": service.entitlements_for(db, principal.member), "ledger": service.ledger(db, principal.id)}


@router.post("/subscriptions/store-sync")
def store_sync(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    from app.modules.billing.revenuecat import sync
    return sync(db, principal.member)


@router.post("/webhooks/revenuecat")
async def revenuecat_webhook(request: Request, authorization: str = Header(default=""), db: Session = Depends(get_db, scope="function")) -> dict:
    from app.models.account import Member
    from app.modules.billing.revenuecat import sync
    secret = get_settings().revenuecat_webhook_authorization
    if not secret or not secrets.compare_digest(authorization, secret):
        raise ApiError("FORBIDDEN", "Invalid webhook authorization.")
    try:
        event = (await request.json())["event"]
        # Provider IDs identify candidates only: never create aliases or link
        # accounts from webhook data. Re-fetch each already-known account.
        identities = [event.get('app_user_id'), event.get('original_app_user_id')]
        for field in ('aliases', 'transferred_from', 'transferred_to'):
            values = event.get(field, [])
            if not isinstance(values, list) or len(values) > 200:
                raise ValueError('invalid identity list')
            identities.extend(values)
        identities = {value for value in identities if isinstance(value, str) and 0 < len(value) <= 36}
        if len(identities) > 20:
            raise ValueError('too many identities')
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ApiError("VALIDATION_ERROR", "Invalid webhook event.") from None
    for identity in sorted(identities):
        member = db.get(Member, identity)
        if member is not None:
            sync(db, member)  # Re-read authoritative status; never grant from event body.
    return {"received": True}


@router.post("/subscriptions/store-purchase")
def store_purchase(data: StorePurchaseIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    """Report a completed App Store or Play Store purchase.

    Idempotent on the store's own transaction id, so a retry, a restore-purchases, or a replay all
    land on the same answer and never activate twice.
    """
    return service.record_store_purchase(db, principal.member, data.store, data.product_id, data.transaction_id)


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
