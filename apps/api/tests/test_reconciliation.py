from datetime import timedelta
from sqlalchemy import select, func
from app.core.db import session_factory
from app.core.timeutil import utcnow
from app.models.billing import Subscription, StoreReconciliation
from app.modules.billing import reconciliation, stores
from tests.test_store_receipts import member, legacy_receipt


def test_dry_run_makes_no_provider_calls_or_writes(client, monkeypatch):
    a = member(client, 'poll-preview')
    legacy_receipt(a)
    monkeypatch.setattr(stores, 'verify', lambda *args: (_ for _ in ()).throw(AssertionError('network not allowed')))
    with session_factory()() as db:
        before = db.scalar(select(func.count()).select_from(StoreReconciliation))
        result = reconciliation.poll(db)
        assert result['mode'] == 'dry_run' and result['provider_calls'] == result['writes'] == 0
        assert reconciliation.migrate_member(db, a.id)['verified_migration'] is False
        assert db.scalar(select(func.count()).select_from(StoreReconciliation)) == before


def test_poll_revokes_refund_without_mobile_restore_and_retries_outage(client, monkeypatch):
    a = member(client, 'poll-refund')
    tx = legacy_receipt(a)
    monkeypatch.setattr(stores, 'missing_configuration', lambda mode: None)
    monkeypatch.setattr(stores, 'verify', lambda store, product, transaction: stores.VerifiedReceipt(product, transaction, utcnow() + timedelta(days=10), 'production'))
    with session_factory()() as db:
        reconciliation.poll(db, apply=True)
        db.commit()
        sub = db.scalar(select(Subscription).where(Subscription.member_id == a.id))
        old_expiry = sub.current_period_end
        for job in db.scalars(select(StoreReconciliation)):
            job.next_check_at = utcnow() - timedelta(seconds=1)
        db.commit()
    def outage(*args): raise stores.ReceiptUnavailable('provider response must not be stored')
    monkeypatch.setattr(stores, 'verify', outage)
    with session_factory()() as db:
        result = reconciliation.poll(db, apply=True)
        db.commit()
        sub = db.scalar(select(Subscription).where(Subscription.member_id == a.id))
        assert result['retry'] > 0 and sub.current_period_end == old_expiry
        for job in db.scalars(select(StoreReconciliation)):
            job.next_check_at = utcnow() - timedelta(seconds=1)
        db.commit()
    def refund(*args): raise stores.ReceiptRefused('revoked', 'provider private message')
    monkeypatch.setattr(stores, 'verify', refund)
    with session_factory()() as db:
        assert reconciliation.poll(db, apply=True)['refused'] > 0
        db.commit()
        sub = db.scalar(select(Subscription).where(Subscription.member_id == a.id))
        assert sub.status == 'expired'
        from app.models.billing import StorePurchase
        receipt = db.scalar(select(StorePurchase).where(StorePurchase.transaction_id == tx))
        job = db.get(StoreReconciliation, receipt.id)
        assert 'private' not in job.outcome


def test_poll_never_mutates_receipt_already_migrated_to_revenuecat(client, monkeypatch):
    from app.models.billing import StorePurchase
    a = member(client, 'poll-migrated')
    tx = legacy_receipt(a)
    monkeypatch.setattr(stores, 'missing_configuration', lambda mode: None)
    with session_factory()() as db:
        receipt = db.scalar(select(StorePurchase).where(StorePurchase.transaction_id == tx))
        db.add(StoreReconciliation(receipt_id=receipt.id, next_check_at=utcnow()))
        receipt.validated_by = 'revenuecat'
        db.commit()
        # Isolate due work: every other receipt has a future retry.
        for job in db.scalars(select(StoreReconciliation).where(StoreReconciliation.receipt_id != receipt.id)):
            job.next_check_at = utcnow() + timedelta(days=1)
        db.commit()
        monkeypatch.setattr(stores, 'verify', lambda *args: (_ for _ in ()).throw(AssertionError('must not reverify migrated receipt')))
        assert reconciliation.poll(db, apply=True)['skipped'] == 1
        assert db.get(StoreReconciliation, receipt.id).next_check_at is None


def test_parallel_pollers_do_not_verify_same_receipt_twice(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    a = member(client, 'poll-concurrent')
    tx = legacy_receipt(a)
    with session_factory()() as db:
        for job in db.scalars(select(StoreReconciliation)):
            job.next_check_at = utcnow() + timedelta(days=1)
        db.commit()
    monkeypatch.setattr(stores, 'missing_configuration', lambda mode: None)
    calls = []
    def verify(store, product, transaction):
        calls.append(transaction)
        return stores.VerifiedReceipt(product, transaction, utcnow() + timedelta(days=10), 'production')
    monkeypatch.setattr(stores, 'verify', verify)
    barrier = Barrier(2)
    def run(_):
        with session_factory()() as db:
            barrier.wait(timeout=10)
            result = reconciliation.poll(db, apply=True)
            db.commit()
            return result
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(run, range(2)))
    assert calls.count(tx) == 1
