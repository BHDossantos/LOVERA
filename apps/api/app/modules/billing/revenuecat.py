"""Server-to-server subscription reconciliation for the SDK already used by mobile.

Google order IDs are useful idempotency keys, never Google purchase tokens.
RevenueCat validates the native receipts; this module reads its authenticated
customer record using ONLY the signed-in member's ID, never a client entitlement.
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.catalog.plans import STORE_PRODUCTS
from app.core.audit import audit
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.timeutil import utcnow
from app.models.account import Member
from app.models.billing import StorePurchase, Subscription


def missing_configuration() -> str | None:
    if not get_settings().revenuecat_secret_api_key:
        return "Server purchase verification is not configured."
    return None


def _date(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("missing subscription expiry")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("expiry has no timezone")
    return parsed.astimezone(timezone.utc)


def _client() -> httpx.Client:
    return httpx.Client(timeout=10.0, follow_redirects=False)


def fetch_subscriptions(member_id: str) -> dict:
    settings = get_settings()
    if settings.store_validation != "revenuecat" or missing_configuration():
        raise ApiError("DEPENDENCY_UNAVAILABLE", "Server purchase verification is not configured.", retryable=True)
    try:
        with _client() as client:
            response = client.get(
                f"https://api.revenuecat.com/v1/subscribers/{quote(member_id, safe='')}",
                headers={"Authorization": f"Bearer {settings.revenuecat_secret_api_key}"},
            )
        response.raise_for_status()
        payload = response.json()["subscriber"]["subscriptions"]
        if not isinstance(payload, dict):
            raise ValueError("invalid subscriptions")
        return payload
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        # Never log the response, Authorization header, or customer attributes.
        raise ApiError("DEPENDENCY_UNAVAILABLE", "Purchase verification is temporarily unavailable. Try Restore purchases again.", retryable=True) from None


def sync(db: Session, member: Member) -> dict:
    from app.modules.billing import service

    # Serialize purchase/restore/webhook reconciliation for this member before
    # fetching the provider snapshot, so a slower old fetch cannot overwrite it.
    db.execute(select(Member.id).where(Member.id == member.id).with_for_update()).scalar_one()
    subscriptions = fetch_subscriptions(member.id)
    settings = get_settings()
    active = []
    observed = []
    try:
        for product, info in subscriptions.items():
            if product not in STORE_PRODUCTS:
                continue
            if not isinstance(info, dict):
                raise ValueError("invalid subscription")
            if info.get("store") not in ("app_store", "play_store"):
                continue
            if settings.is_production and info.get("is_sandbox") is not False:
                continue
            expiry = _date(info.get("expires_date"))
            if info.get("grace_period_expires_date"):
                expiry = max(expiry, _date(info["grace_period_expires_date"]))
            transaction = info.get("store_transaction_id")
            valid_transaction = isinstance(transaction, (str, int)) and bool(str(transaction)) and len(str(transaction)) <= 128
            if valid_transaction:
                observed.append((product, info["store"], str(transaction)))
            if info.get("refunded_at") or expiry <= utcnow():
                continue
            if not valid_transaction:
                raise ValueError("missing store transaction")
            active.append((product, info, expiry, str(transaction)))
    except (ValueError, TypeError, OverflowError):
        raise ApiError("DEPENDENCY_UNAVAILABLE", "The store returned incomplete subscription information. Try again later.", retryable=True) from None

    # The same store transaction may have been granted by the direct verifier
    # before RevenueCat was enabled. It is one payment, not two subscriptions.
    # Retire only that exact direct reference, in this transaction, including
    # when the first provider snapshot already reports its refund/expiry.
    for product, store, transaction in observed:
        receipt = db.scalar(select(StorePurchase).where(StorePurchase.store == store, StorePurchase.transaction_id == transaction))
        if receipt is None:
            continue
        if receipt.member_id != member.id or receipt.product_id != product:
            raise ApiError("CONFLICT", "This purchase is associated with another membership.")
        direct = db.scalar(select(Subscription).where(Subscription.provider_subscription_ref == f"{store}:{transaction}"))
        if direct is None:
            continue
        if direct.member_id != member.id or direct.provider != store or direct.plan != STORE_PRODUCTS[product][0]:
            raise ApiError("CONFLICT", "The original subscription does not match this purchase.")
        direct.status = "expired"
        audit(db, actor_type="vendor", actor_id=None, action="billing.direct_grant_reconciled", resource_type="subscription", resource_id=direct.id, metadata={"store": store, "product_id": product})

    # Expire only subscriptions managed by this integration. An unavailable or
    # malformed provider response above never revokes cached access prematurely.
    managed = list(db.scalars(select(Subscription).where(Subscription.member_id == member.id, Subscription.provider == "revenuecat")))
    if not active:
        for sub in managed:
            sub.status = "expired"
        db.flush()
        return {"status": "no_active_purchase", "entitlements": service.entitlements_for(db, member)}

    # Reconcile every active provider product, not only the strongest tier.
    # Entitlement selection is separate from retaining independently paid records.
    current_ids = set()
    for product, info, expiry, transaction in sorted(active, key=lambda row: row[0]):
        plan, cadence = STORE_PRODUCTS[product]
        receipt = db.scalar(select(StorePurchase).where(StorePurchase.store == info["store"], StorePurchase.transaction_id == transaction))
        if receipt and (receipt.member_id != member.id or receipt.product_id != product):
            raise ApiError("CONFLICT", "This purchase is associated with another membership. Contact support before transferring it.")
        reference = f"rc:{member.id}:{info['store']}:{product}"
        sub = service.activate_subscription(db, member.id, plan, "revenuecat", reference, cadence=cadence, period_end=expiry)
        current_ids.add(sub.id)
        sub.status = "active"
        sub.current_period_end = expiry
        sub.cancel_at_period_end = bool(info.get("unsubscribe_detected_at"))
        sub.provider_customer_ref = member.id
        if receipt is None:
            receipt = StorePurchase(member_id=member.id, store=info["store"], product_id=product, transaction_id=transaction, plan=plan, cadence=cadence)
            db.add(receipt)
        receipt.status = "granted"
        receipt.validated_by = "revenuecat"
        receipt.subscription_id = sub.id
        try:
            db.flush()
        except IntegrityError:
            raise ApiError("CONFLICT", "Purchase ownership changed concurrently. Retry reconciliation.") from None
        audit(db, actor_type="vendor", actor_id=None, action="billing.store_reconciled", resource_type="subscription", resource_id=sub.id, metadata={"store": info["store"], "product_id": product})
    for old in managed:
        if old.id not in current_ids:
            old.status = "expired"
    db.flush()
    return {"status": "granted", "entitlements": service.entitlements_for(db, member)}
