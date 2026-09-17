"""Subscriptions, entitlements and the protected credit ledger."""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog.plans import PAID_PLANS, PLANS, RENEWAL_TERMS
from app.core.analytics import track
from app.core.audit import audit
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import verify_webhook
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.billing import CheckoutSession, CreditLedger, Subscription, WebhookReceipt
from app.models.introductions import Introduction


def current_subscription(db: Session, member_id: str) -> Subscription | None:
    sub = db.execute(select(Subscription).where(Subscription.member_id == member_id, Subscription.status.in_(("trialing", "active", "past_due"))).order_by(Subscription.started_at.desc())).scalars().first()
    if sub and sub.current_period_end and sub.current_period_end <= utcnow() and sub.cancel_at_period_end:
        sub.status = "expired"
        return None
    return sub


def credit_balance(db: Session, member_id: str) -> int:
    last = db.execute(select(CreditLedger).where(CreditLedger.member_id == member_id).order_by(CreditLedger.created_at.desc(), CreditLedger.id.desc()).limit(1)).scalar_one_or_none()
    return last.balance_after if last else 0


def trial_used(db: Session, member_id: str) -> int:
    from sqlalchemy import func, or_

    return db.execute(
        select(func.count(Introduction.id)).where(
            or_(Introduction.member_a_id == member_id, Introduction.member_b_id == member_id),
            Introduction.status != "draft",
        )
    ).scalar() or 0


def entitlements_for(db: Session, member: Member) -> dict[str, Any]:
    settings = get_settings()
    sub = current_subscription(db, member.id)
    plan_id = sub.plan if sub else "free"
    paid = plan_id in PAID_PLANS
    used = trial_used(db, member.id)
    return {
        "plan": plan_id,
        "plan_name": PLANS[plan_id]["name"],
        "paid": paid,
        "weekly_intro_cap": PLANS[plan_id]["weekly_intro_cap"],
        "trial_introductions_remaining": 0 if paid else max(settings.trial_introductions - used, 0),
        "ai_wingman": paid,
        "translation": paid,
        "date_concierge": paid,
        "adaptive_refresh": paid,
        "travel_mode": False,  # deferred until after the single city pilot
        "dating_passport": False,
        "protected_credits": credit_balance(db, member.id),
        "safety_tools": True,
        "messaging": True,
        "manual_date_planning": True,
        "renews_at": iso(sub.current_period_end) if sub else None,
        "cancel_at_period_end": bool(sub.cancel_at_period_end) if sub else False,
        "status": sub.status if sub else "none",
    }


def plans_payload() -> dict[str, Any]:
    return {"plans": list(PLANS.values()), "renewal_terms": RENEWAL_TERMS, "principles": ["No boosts, super-likes or pay-to-reach.", "Verification, blocking, reporting and check-ins are always free.", "Protected credit when no qualified introduction is available in a paid week."]}


def create_checkout(db: Session, member: Member, plan_id: str, idempotency_key: str | None) -> dict[str, Any]:
    if plan_id not in PAID_PLANS:
        raise ApiError("VALIDATION_ERROR", "Choose a paid plan.", field_errors={"plan": "invalid"})
    if idempotency_key:
        existing = db.execute(select(CheckoutSession).where(CheckoutSession.member_id == member.id, CheckoutSession.idempotency_key == idempotency_key)).scalar_one_or_none()
        if existing:
            return checkout_payload(existing)
    settings = get_settings()
    session = CheckoutSession(member_id=member.id, plan=plan_id, provider=settings.payments_provider, provider_ref=f"cs_{secrets.token_urlsafe(10)}", idempotency_key=idempotency_key)
    db.add(session)
    db.flush()
    audit(db, actor_type="member", actor_id=member.id, action="billing.checkout_created", resource_type="checkout", resource_id=session.id, metadata={"plan": plan_id})
    return checkout_payload(session)


def checkout_payload(session: CheckoutSession) -> dict[str, Any]:
    plan = PLANS[session.plan]
    return {
        "checkout_id": session.id,
        "provider": session.provider,
        "provider_ref": session.provider_ref,
        "hosted_url": f"/you/membership/checkout?ref={session.provider_ref}",
        "status": session.status,
        "plan": plan["id"],
        "price_cents": plan["price_cents"],
        "currency": plan["currency"],
        "renewal_terms": RENEWAL_TERMS,
        "inventory_notice": "Introductions depend on qualified, verified inventory in your city. If we cannot introduce you in a paid week, you receive a protected credit.",
    }


def activate_subscription(db: Session, member_id: str, plan_id: str, provider: str, provider_subscription_ref: str, period_days: int = 30) -> Subscription:
    existing = db.execute(select(Subscription).where(Subscription.provider_subscription_ref == provider_subscription_ref)).scalar_one_or_none()
    if existing:
        return existing
    for old in db.execute(select(Subscription).where(Subscription.member_id == member_id, Subscription.status.in_(("active", "trialing", "past_due")))).scalars():
        old.status = "cancelled"
        old.cancelled_at = utcnow()
    sub = Subscription(member_id=member_id, provider=provider, provider_subscription_ref=provider_subscription_ref, plan=plan_id, status="active", price_cents=PLANS[plan_id]["price_cents"], currency="EUR", current_period_end=utcnow() + timedelta(days=period_days))
    db.add(sub)
    db.flush()
    track(db, "subscription_started", member_id, plan=plan_id, price=PLANS[plan_id]["price_cents"], currency="EUR", channel=provider)
    audit(db, actor_type="vendor", actor_id=None, action="billing.subscription_activated", resource_type="subscription", resource_id=sub.id, metadata={"plan": plan_id})
    return sub


def cancel(db: Session, member: Member, reason: str | None) -> dict[str, Any]:
    sub = current_subscription(db, member.id)
    if sub is None:
        raise ApiError("CONFLICT", "You do not have an active subscription.")
    sub.cancel_at_period_end = True
    sub.cancelled_at = utcnow()
    sub.cancel_reason = (reason or "")[:48] or None
    audit(db, actor_type="member", actor_id=member.id, action="billing.cancelled", resource_type="subscription", resource_id=sub.id, metadata={"reason": sub.cancel_reason})
    return entitlements_for(db, member)


def grant_credit(db: Session, member_id: str, amount: int, reason: str, reference: str, match_run_id: str | None = None, introduction_id: str | None = None) -> CreditLedger | None:
    if db.execute(select(CreditLedger.id).where(CreditLedger.reference == reference)).first():
        return None
    balance = credit_balance(db, member_id) + amount
    entry = CreditLedger(member_id=member_id, amount=amount, reason=reason, reference=reference, match_run_id=match_run_id, introduction_id=introduction_id, balance_after=balance, expires_at=utcnow() + timedelta(days=180))
    db.add(entry)
    db.flush()
    track(db, "credit_changed", member_id, delta=amount, reason=reason, balance=balance)
    return entry


def ledger(db: Session, member_id: str) -> list[dict[str, Any]]:
    rows = db.execute(select(CreditLedger).where(CreditLedger.member_id == member_id).order_by(CreditLedger.created_at.desc()).limit(50)).scalars().all()
    return [{"id": r.id, "amount": r.amount, "reason": r.reason, "balance_after": r.balance_after, "created_at": iso(r.created_at), "expires_at": iso(r.expires_at)} for r in rows]


def handle_payment_webhook(db: Session, body: bytes, timestamp: str, signature: str) -> dict[str, Any]:
    settings = get_settings()
    if not verify_webhook(settings.payments_webhook_secret, body, timestamp, signature):
        raise ApiError("FORBIDDEN", "Invalid webhook signature.")
    payload = json.loads(body.decode("utf-8"))
    event_id = str(payload.get("id") or hashlib.sha256(body).hexdigest())
    if db.execute(select(WebhookReceipt).where(WebhookReceipt.provider == "payments", WebhookReceipt.provider_event_id == event_id)).first():
        return {"received": True, "duplicate": True}
    receipt = WebhookReceipt(provider="payments", provider_event_id=event_id, event_type=str(payload.get("type")), body_hash=hashlib.sha256(body).hexdigest(), payload={"type": payload.get("type")})
    db.add(receipt)
    db.flush()
    event_type = payload.get("type")
    data = payload.get("data", {})
    if event_type == "checkout.session.completed":
        session = db.execute(select(CheckoutSession).where(CheckoutSession.provider_ref == data.get("checkout_ref"))).scalar_one_or_none()
        if session is None:
            raise ApiError("NOT_FOUND", "Unknown checkout session.")
        if session.status != "completed":
            session.status = "completed"
            session.completed_at = utcnow()
            activate_subscription(db, session.member_id, session.plan, session.provider, data.get("subscription_ref") or f"sub_{session.provider_ref}")
    elif event_type == "invoice.payment_failed":
        sub = db.execute(select(Subscription).where(Subscription.provider_subscription_ref == data.get("subscription_ref"))).scalar_one_or_none()
        if sub:
            sub.status = "past_due"
    elif event_type == "customer.subscription.deleted":
        sub = db.execute(select(Subscription).where(Subscription.provider_subscription_ref == data.get("subscription_ref"))).scalar_one_or_none()
        if sub:
            sub.status = "cancelled"
            sub.cancelled_at = utcnow()
    receipt.status = "processed"
    receipt.processed_at = utcnow()
    return {"received": True, "duplicate": False}
