"""Historical App Store lifecycle polling and read-only migration inventory.

No purchase, charge, cancellation or RevenueCat import is performed here. Running
with apply=False does not call a provider or write data. Apply mode is an operator
operation requiring a configured isolated environment or approved release plan.
"""
from datetime import timedelta
from sqlalchemy import select, func, inspect
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from app.core.timeutil import utcnow
from app.models.account import Member
from app.models.billing import StorePurchase, Subscription, StoreReconciliation
from app.modules.billing import stores, revenuecat
from app.core.errors import ApiError


def inventory(db: Session) -> dict:
    rows = db.scalars(select(StorePurchase).where(StorePurchase.store == 'app_store', StorePurchase.subscription_id.isnot(None), StorePurchase.validated_by != 'revenuecat')).all()
    tracking_ready = inspect(db.get_bind()).has_table('store_reconciliations')
    due = db.scalar(select(func.count()).select_from(StoreReconciliation).where(StoreReconciliation.next_check_at <= utcnow())) if tracking_ready else None
    oldest = db.scalar(select(func.min(StoreReconciliation.next_check_at)).where(StoreReconciliation.next_check_at <= utcnow())) if tracking_ready else None
    return {'mode': 'dry_run', 'tracking_schema_ready': tracking_ready, 'due_jobs': due, 'oldest_due_at': oldest.isoformat() if oldest else None, 'historical_receipts': len(rows), 'members': len({r.member_id for r in rows}),
            'provider_calls': 0, 'writes': 0,
            'migration_prerequisite': 'Historical receipts must already exist in the configured RevenueCat project. Transaction IDs are not raw Apple receipts or Google purchase tokens.'}


def poll(db: Session, *, apply: bool = False, limit: int = 100) -> dict:
    if not apply:
        return inventory(db)
    if not 1 <= limit <= 100:
        raise ValueError('limit must be between 1 and 100')
    missing = stores.missing_configuration('app_store')
    if missing:
        raise ApiError('DEPENDENCY_UNAVAILABLE', 'App Store verification credentials are not configured.')
    now = utcnow()
    # Missing-job scan progresses on each invocation, rather than repeatedly
    # scanning only the first page of an already-seeded receipt list.
    unseen = db.scalars(select(StorePurchase).outerjoin(StoreReconciliation, StoreReconciliation.receipt_id == StorePurchase.id).where(
        StorePurchase.store == 'app_store', StorePurchase.subscription_id.isnot(None),
        StorePurchase.validated_by != 'revenuecat', StoreReconciliation.receipt_id.is_(None)
    ).order_by(StorePurchase.id).limit(limit)).all()
    for receipt in unseen:
        db.execute(insert(StoreReconciliation).values(receipt_id=receipt.id, next_check_at=now, attempts=0, outcome='pending').on_conflict_do_nothing(index_elements=['receipt_id']))
    db.flush()
    jobs = db.scalars(select(StoreReconciliation).where(StoreReconciliation.next_check_at <= now).order_by(StoreReconciliation.next_check_at, StoreReconciliation.receipt_id).limit(limit).with_for_update(skip_locked=True)).all()
    counts = {'checked': 0, 'active': 0, 'refused': 0, 'retry': 0, 'skipped': 0}
    for job in jobs:
        receipt = db.get(StorePurchase, job.receipt_id)
        if receipt is None:
            continue
        db.execute(select(Member.id).where(Member.id == receipt.member_id).with_for_update()).scalar_one_or_none()
        # A concurrent RevenueCat migration may have moved the receipt while we
        # waited for its member lock. Never mutate that integration's grant.
        db.refresh(receipt)
        sub = db.get(Subscription, receipt.subscription_id) if receipt.subscription_id else None
        if receipt.validated_by == 'revenuecat' or sub is None or sub.member_id != receipt.member_id or sub.provider != 'app_store' or sub.provider_subscription_ref != 'app_store:' + receipt.transaction_id:
            job.outcome, job.next_check_at = 'migrated_or_unlinked', None
            counts['skipped'] += 1
            continue
        counts['checked'] += 1
        try:
            verified = stores.verify('app_store', receipt.product_id, receipt.transaction_id)
            # A known subscription must have a bounded verified expiry; no
            # fallback to a freshly invented monthly term on a missing field.
            if verified.product_id != receipt.product_id or verified.transaction_id != receipt.transaction_id:
                raise stores.ReceiptUnavailable('provider returned a different receipt')
            if verified.expires_at is None:
                raise stores.ReceiptUnavailable('missing subscription expiry')
            from app.core.config import get_settings
            if get_settings().is_production and verified.environment != 'production':
                raise stores.ReceiptRefused('sandbox', 'Test receipt cannot grant production access')
            sub.current_period_end = verified.expires_at
            sub.status = 'active' if verified.expires_at > now else 'expired'
            receipt.status = 'granted' if sub.status == 'active' else 'refused_expired'
            job.outcome = sub.status
            job.attempts = 0
            job.next_check_at = now + timedelta(hours=1)
            counts['active' if sub.status == 'active' else 'refused'] += 1
        except stores.ReceiptRefused as error:
            sub.status = 'expired'
            # Store only bounded reason codes, never provider response bodies.
            receipt.status = 'refused_' + error.reason[:23]
            job.outcome, job.attempts = 'refused', 0
            job.next_check_at = now + timedelta(hours=1)
            counts['refused'] += 1
        except stores.ReceiptUnavailable:
            job.attempts += 1
            job.outcome = 'retry'
            job.next_check_at = now + timedelta(minutes=min(60, 5 * 2 ** min(job.attempts - 1, 4)))
            if sub.current_period_end and sub.current_period_end <= now:
                sub.status = 'expired'
            counts['retry'] += 1
        job.checked_at = now
    db.flush()
    due = db.scalar(select(func.count()).select_from(StoreReconciliation).where(StoreReconciliation.next_check_at <= now))
    untracked = db.scalar(select(func.count()).select_from(StorePurchase).outerjoin(StoreReconciliation, StoreReconciliation.receipt_id == StorePurchase.id).where(StorePurchase.store == 'app_store', StorePurchase.subscription_id.isnot(None), StorePurchase.validated_by != 'revenuecat', StoreReconciliation.receipt_id.is_(None)))
    return {'mode': 'apply', **counts, 'due_remaining': due, 'untracked_receipts': untracked}


def migrate_member(db: Session, member_id: str, *, apply: bool = False) -> dict:
    member = db.get(Member, member_id)
    if member is None:
        raise ValueError('Unknown member')
    if not apply:
        count = db.scalar(select(func.count()).select_from(StorePurchase).where(StorePurchase.member_id == member_id, StorePurchase.subscription_id.isnot(None)))
        return {'mode': 'dry_run', 'linked_receipts': count, 'writes': 0, 'provider_calls': 0, 'verified_migration': False}
    # Server-to-server GET reconciliation only, never POST /receipts with a
    # guessed order ID. Exact-transaction migration/ownership is enforced by sync.
    result = revenuecat.sync(db, member)
    remaining = db.scalar(select(func.count()).select_from(Subscription).where(Subscription.member_id == member_id, Subscription.provider.in_(('app_store', 'play_store')), Subscription.status.in_(('active', 'trialing', 'past_due'))))
    return {'mode': 'apply', 'status': result['status'], 'plan': result['entitlements']['plan'], 'remaining_direct_grants': remaining, 'migration_complete': remaining == 0}
