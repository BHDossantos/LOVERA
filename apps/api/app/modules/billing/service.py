"""Subscriptions, entitlements and the protected credit ledger."""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog.plans import (
    CADENCES,
    FEATURES,
    PAID_PLANS,
    PERIOD_DAYS,
    PLANS,
    RENEWAL_TERMS,
    grants,
    plan_payload,
    price_cents,
)
from app.core.analytics import track
from app.core.audit import audit
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import verify_webhook
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.billing import BillingTerm, CheckoutSession, CreditLedger, Subscription, WebhookReceipt
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


def term_for(db: Session, subject_type: str, subject_id: str) -> BillingTerm | None:
    return db.execute(
        select(BillingTerm).where(BillingTerm.subject_type == subject_type, BillingTerm.subject_id == subject_id)
    ).scalar_one_or_none()


def record_term(db: Session, subject_type: str, subject_id: str, plan_id: str, cadence: str) -> BillingTerm:
    existing = term_for(db, subject_type, subject_id)
    if existing:
        return existing
    term = BillingTerm(
        subject_type=subject_type,
        subject_id=subject_id,
        plan=plan_id,
        cadence=cadence,
        price_cents=price_cents(plan_id, cadence),
        currency=PLANS[plan_id]["currency"],
        period_days=PERIOD_DAYS[cadence],
    )
    db.add(term)
    db.flush()
    return term


def entitlements_for(db: Session, member: Member) -> dict[str, Any]:
    settings = get_settings()
    sub = current_subscription(db, member.id)
    plan_id = sub.plan if sub else "free"
    paid = plan_id in PAID_PLANS
    used = trial_used(db, member.id)
    term = term_for(db, "subscription", sub.id) if sub else None
    # Every feature flag comes from the plan's own feature list, so a plan cannot advertise
    # something in `included` that it does not actually grant. These used to be written out one
    # by one as `paid`, which meant Concierge granted exactly what Pro did at more than twice the
    # price while its bullets promised two things it never delivered.
    out: dict[str, Any] = {FEATURE: grants(plan_id, FEATURE) for FEATURE in FEATURES}
    out.update(
        {
            "plan": plan_id,
            "plan_name": PLANS[plan_id]["name"],
            "paid": paid,
            "weekly_intro_cap": PLANS[plan_id]["weekly_intro_cap"],
            "trial_introductions_remaining": 0 if paid else max(settings.trial_introductions - used, 0),
            "travel_mode": False,  # deferred until after the single city pilot
            "dating_passport": False,
            # The balance, not the entitlement. `protected_credits` is a count everywhere it is
            # rendered, so it keeps that meaning and overwrites the boolean from the loop above.
            "protected_credits": credit_balance(db, member.id),
            "earns_protected_credits": grants(plan_id, "protected_credits"),
            "safety_tools": True,
            "messaging": True,
            "manual_date_planning": True,
            "cadence": term.cadence if term else "monthly",
            "price_cents": term.price_cents if term else price_cents(plan_id, "monthly"),
            "currency": term.currency if term else PLANS[plan_id]["currency"],
            "renews_at": iso(sub.current_period_end) if sub else None,
            "cancel_at_period_end": bool(sub.cancel_at_period_end) if sub else False,
            "status": sub.status if sub else "none",
        }
    )
    return out


def plans_payload() -> dict[str, Any]:
    return {
        "plans": [plan_payload(p) for p in PLANS],
        "cadences": list(CADENCES),
        "renewal_terms": RENEWAL_TERMS,
        "principles": [
            "No boosts, super-likes or pay-to-reach.",
            "Verification, blocking, reporting and check-ins are always free.",
            "Protected credit when no qualified introduction is available in a paid week.",
            "Annual is ten months for twelve, and the monthly price is always shown beside it.",
        ],
    }


def create_checkout(db: Session, member: Member, plan_id: str, idempotency_key: str | None, cadence: str = "monthly") -> dict[str, Any]:
    if plan_id not in PAID_PLANS:
        raise ApiError("VALIDATION_ERROR", "Choose a paid plan.", field_errors={"plan": "invalid"})
    if cadence not in CADENCES:
        raise ApiError("VALIDATION_ERROR", "Choose monthly or annual.", field_errors={"cadence": "invalid"})
    if idempotency_key:
        existing = db.execute(select(CheckoutSession).where(CheckoutSession.member_id == member.id, CheckoutSession.idempotency_key == idempotency_key)).scalar_one_or_none()
        if existing:
            return checkout_payload(db, existing)
    settings = get_settings()
    session = CheckoutSession(member_id=member.id, plan=plan_id, provider=settings.payments_provider, provider_ref=f"cs_{secrets.token_urlsafe(10)}", idempotency_key=idempotency_key)
    db.add(session)
    db.flush()
    record_term(db, "checkout", session.id, plan_id, cadence)
    audit(db, actor_type="member", actor_id=member.id, action="billing.checkout_created", resource_type="checkout", resource_id=session.id, metadata={"plan": plan_id, "cadence": cadence})
    return checkout_payload(db, session)


def checkout_payload(db: Session, session: CheckoutSession) -> dict[str, Any]:
    plan = PLANS[session.plan]
    term = term_for(db, "checkout", session.id)
    cadence = term.cadence if term else "monthly"
    cents = term.price_cents if term else price_cents(session.plan, cadence)
    return {
        "checkout_id": session.id,
        "provider": session.provider,
        "provider_ref": session.provider_ref,
        "hosted_url": f"/you/membership/checkout?ref={session.provider_ref}",
        "status": session.status,
        "plan": plan["id"],
        "plan_name": plan["name"],
        "cadence": cadence,
        "price_cents": cents,
        "period_days": term.period_days if term else PERIOD_DAYS[cadence],
        "currency": plan["currency"],
        "renewal_terms": RENEWAL_TERMS,
        "inventory_notice": "Introductions depend on qualified, verified inventory in your city. If we cannot introduce you in a paid week, you receive a protected credit.",
    }


def checkout_detail(db: Session, member: Member, provider_ref: str) -> dict[str, Any]:
    session = db.execute(select(CheckoutSession).where(CheckoutSession.provider_ref == provider_ref)).scalar_one_or_none()
    # Same answer for "no such checkout" and "somebody else's checkout": a distinguishable error
    # would turn this into a way to probe whether a reference is real.
    if session is None or session.member_id != member.id:
        raise ApiError("NOT_FOUND", "We could not find that checkout.")
    return checkout_payload(db, session)


def activate_subscription(db: Session, member_id: str, plan_id: str, provider: str, provider_subscription_ref: str, cadence: str = "monthly") -> Subscription:
    """Start a subscription on the cadence the member actually bought.

    `period_days` used to be a parameter defaulting to 30, and every caller took the default — so
    an annual purchase would have renewed in a month. The cadence decides the period now, and the
    agreed price is copied onto the subscription and its term rather than read back out of the
    catalog, so repricing the catalog never reprices somebody who already bought.
    """
    existing = db.execute(select(Subscription).where(Subscription.provider_subscription_ref == provider_subscription_ref)).scalar_one_or_none()
    if existing:
        return existing
    for old in db.execute(select(Subscription).where(Subscription.member_id == member_id, Subscription.status.in_(("active", "trialing", "past_due")))).scalars():
        old.status = "cancelled"
        old.cancelled_at = utcnow()
    cents = price_cents(plan_id, cadence)
    sub = Subscription(member_id=member_id, provider=provider, provider_subscription_ref=provider_subscription_ref, plan=plan_id, status="active", price_cents=cents, currency=PLANS[plan_id]["currency"], current_period_end=utcnow() + timedelta(days=PERIOD_DAYS[cadence]))
    db.add(sub)
    db.flush()
    record_term(db, "subscription", sub.id, plan_id, cadence)
    track(db, "subscription_started", member_id, plan=plan_id, price=cents, currency=PLANS[plan_id]["currency"], channel=provider, cadence=cadence)
    audit(db, actor_type="vendor", actor_id=None, action="billing.subscription_activated", resource_type="subscription", resource_id=sub.id, metadata={"plan": plan_id, "cadence": cadence})
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
            bought = term_for(db, "checkout", session.id)
            activate_subscription(
                db,
                session.member_id,
                session.plan,
                session.provider,
                data.get("subscription_ref") or f"sub_{session.provider_ref}",
                cadence=bought.cadence if bought else "monthly",
            )
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
