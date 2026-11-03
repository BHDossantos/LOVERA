from datetime import timedelta
import uuid
import httpx
import pytest
from sqlalchemy import select, func
from app.core.config import get_settings
from app.core.db import session_factory
from app.core.timeutil import utcnow
from app.models.billing import StorePurchase, Subscription
from app.modules.billing import revenuecat
from tests.test_store_receipts import member

@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setattr(get_settings(), 'store_validation', 'revenuecat')
    monkeypatch.setattr(get_settings(), 'revenuecat_secret_api_key', 'test-server-key')
    data = {'pro_monthly': dict(store='play_store', store_transaction_id=f'GPA.{uuid.uuid4().hex}', expires_date=(utcnow() + timedelta(days=30)).isoformat(), is_sandbox=False)}
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={'subscriber': {'subscriptions': data}})
    monkeypatch.setattr(revenuecat, '_client', lambda: httpx.Client(transport=httpx.MockTransport(handle)))
    return data, requests

def test_android_reconciles_server_receipt_and_is_idempotent(client, provider):
    data, requests = provider
    a = member(client, 'rc-android')
    first = a.post('/subscriptions/store-sync', json={'member_id': 'attacker', 'plan': 'concierge'})
    assert first.status_code == 200, first.text
    assert first.json()['entitlements']['plan'] == 'pro'
    assert first.json()['entitlements']['management_url'].startswith('https://play.google.com/')
    assert requests[-1].url.path.endswith('/' + a.id)
    assert requests[-1].headers['authorization'] == 'Bearer test-server-key'
    assert a.post('/subscriptions/store-sync').status_code == 200
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(Subscription).where(Subscription.member_id == a.id)) == 1
        assert db.scalar(select(func.count()).select_from(StorePurchase).where(StorePurchase.member_id == a.id)) == 1

def test_renewal_updates_expiry_without_duplicate_subscription(client, provider):
    data, _ = provider
    a = member(client, 'rc-renew')
    assert a.post('/subscriptions/store-sync').status_code == 200
    data['pro_monthly']['expires_date'] = (utcnow() + timedelta(days=60)).isoformat()
    data['pro_monthly']['store_transaction_id'] += '.1'
    response = a.post('/subscriptions/store-sync')
    assert response.status_code == 200
    assert response.json()['entitlements']['renews_at'].startswith(data['pro_monthly']['expires_date'][:10])
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(Subscription).where(Subscription.member_id == a.id)) == 1

@pytest.mark.parametrize('change', [{'refunded_at': '2026-01-01T00:00:00Z'}, {'expires_date': '2020-01-01T00:00:00Z'}])
def test_refund_or_expiry_revokes_access(client, provider, change):
    data, _ = provider
    a = member(client, 'rc-revoke')
    assert a.post('/subscriptions/store-sync').json()['entitlements']['paid']
    data['pro_monthly'].update(change)
    response = a.post('/subscriptions/store-sync')
    assert response.status_code == 200
    assert not response.json()['entitlements']['paid']

def test_production_rejects_sandbox_and_unknown_store(client, provider, monkeypatch):
    data, _ = provider
    a = member(client, 'rc-production')
    monkeypatch.setattr(get_settings(), 'env', 'production')
    for fields in ({'is_sandbox': True}, {'is_sandbox': False, 'store': 'promotional'}):
        data['pro_monthly'].update(fields)
        assert not a.post('/subscriptions/store-sync').json()['entitlements']['paid']

def test_missing_configuration_fails_closed(client, monkeypatch):
    monkeypatch.setattr(get_settings(), 'store_validation', 'revenuecat')
    monkeypatch.setattr(get_settings(), 'revenuecat_secret_api_key', None)
    a = member(client, 'rc-unconfigured')
    assert not a.get('/plans').json()['store']['enabled']
    assert a.post('/subscriptions/store-sync').status_code == 503

def test_temporary_outage_can_be_retried(client, provider, monkeypatch):
    a = member(client, 'rc-retry')
    real = revenuecat._client
    monkeypatch.setattr(revenuecat, '_client', lambda: httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503))))
    response = a.post('/subscriptions/store-sync')
    assert response.status_code == 503
    assert response.json()['error']['retryable']
    monkeypatch.setattr(revenuecat, '_client', real)
    assert a.post('/subscriptions/store-sync').json()['entitlements']['paid']

def test_malformed_response_does_not_revoke_an_existing_grant(client, provider):
    data, _ = provider
    a = member(client, 'rc-malformed')
    assert a.post('/subscriptions/store-sync').status_code == 200
    data['pro_monthly']['expires_date'] = 'bad-date'
    assert a.post('/subscriptions/store-sync').status_code == 503
    with session_factory()() as db:
        assert db.scalar(select(Subscription).where(Subscription.member_id == a.id)).status == 'active'

def test_subscription_cannot_be_claimed_by_two_members(client, provider):
    a, b = member(client, 'rc-owner'), member(client, 'rc-other')
    assert a.post('/subscriptions/store-sync').status_code == 200
    assert b.post('/subscriptions/store-sync').status_code == 409

def test_cancellation_is_managed_in_store_not_local_flag(client, provider):
    a = member(client, 'rc-cancel')
    assert a.post('/subscriptions/store-sync').status_code == 200
    assert a.post('/subscriptions/cancel', json={}).status_code == 409

def test_webhook_auth_and_refund_reconciliation(client, provider, monkeypatch):
    data, _ = provider
    a = member(client, 'rc-webhook')
    assert a.post('/subscriptions/store-sync').status_code == 200
    monkeypatch.setattr(get_settings(), 'revenuecat_webhook_authorization', 'test-webhook')
    event = {'event': {'app_user_id': a.id, 'type': 'CANCELLATION', 'plan': 'concierge'}}
    assert client.post('/v1/webhooks/revenuecat', json=event).status_code == 403
    data['pro_monthly']['refunded_at'] = '2026-01-01T00:00:00Z'
    assert client.post('/v1/webhooks/revenuecat', json=event, headers={'Authorization': 'test-webhook'}).status_code == 200
    with session_factory()() as db:
        assert db.scalar(select(Subscription).where(Subscription.member_id == a.id)).status == 'expired'

def test_direct_receipt_endpoint_cannot_bypass_revenuecat(client, provider):
    a = member(client, 'rc-no-bypass')
    assert a.post('/subscriptions/store-purchase', json={'store': 'play_store', 'product_id': 'pro_monthly', 'transaction_id': 'invented'}).status_code == 422

def test_expired_store_access_does_not_survive_without_cancellation_flag(client, provider):
    from app.modules.billing.service import entitlements_for
    from app.models.account import Member
    a = member(client, 'rc-offline-expiry')
    assert a.post('/subscriptions/store-sync').status_code == 200
    with session_factory()() as db:
        sub = db.scalar(select(Subscription).where(Subscription.member_id == a.id))
        sub.current_period_end = utcnow() - timedelta(seconds=1)
        sub.cancel_at_period_end = False
        db.flush()
        assert not entitlements_for(db, db.get(Member, a.id))['paid']

@pytest.mark.parametrize('change', [{'refunded_at': '2026-01-01T00:00:00Z'}, {'expires_date': '2020-01-01T00:00:00Z'}])
def test_native_refund_or_expiry_preserves_separately_paid_subscription(client, provider, change):
    from app.modules.billing import service
    data, requests = provider
    a = member(client, 'rc-overlap-' + uuid.uuid4().hex)
    with session_factory()() as db:
        paid = service.activate_subscription(db, a.id, 'concierge', 'payments', 'external-' + a.id)
        paid_id = paid.id
        db.commit()
    assert a.post('/subscriptions/store-sync').json()['entitlements']['plan'] == 'concierge'
    data['pro_monthly'].update(change)
    assert a.post('/subscriptions/store-sync').json()['entitlements']['plan'] == 'concierge'
    assert all(request.method == 'GET' for request in requests)
    with session_factory()() as db:
        assert db.get(Subscription, paid_id).status == 'active'
        assert db.get(Subscription, paid_id).cancelled_at is None


def test_native_products_renew_independently_and_fall_back_to_remaining_paid_tier(client, provider):
    data, _ = provider
    a = member(client, 'rc-two-products')
    data['concierge_annual'] = {**data['pro_monthly'], 'store': 'app_store', 'store_transaction_id': 'apple-' + a.id}
    assert a.post('/subscriptions/store-sync').json()['entitlements']['plan'] == 'concierge'
    data['pro_monthly']['expires_date'] = (utcnow() + timedelta(days=90)).isoformat()
    data['pro_monthly']['store_transaction_id'] += '-renewal'
    assert a.post('/subscriptions/store-sync').json()['entitlements']['plan'] == 'concierge'
    data['concierge_annual']['refunded_at'] = utcnow().isoformat()
    result = a.post('/subscriptions/store-sync').json()['entitlements']
    assert result['plan'] == 'pro'
    assert result['renews_at'].startswith(data['pro_monthly']['expires_date'][:10])
    with session_factory()() as db:
        rows = db.scalars(select(Subscription).where(Subscription.member_id == a.id)).all()
        assert len(rows) == 2
        assert {row.plan: row.status for row in rows} == {'pro': 'active', 'concierge': 'expired'}


def test_expired_newest_subscription_does_not_hide_older_paid_provider(client, provider):
    from app.modules.billing import service
    from app.models.account import Member
    a = member(client, 'rc-expiry-fallback')
    with session_factory()() as db:
        external = service.activate_subscription(db, a.id, 'pro', 'payments', 'external-' + a.id)
        native = service.activate_subscription(db, a.id, 'concierge', 'app_store', 'native-' + a.id, period_end=utcnow() - timedelta(seconds=1))
        entitlement = service.entitlements_for(db, db.get(Member, a.id))
        assert entitlement['plan'] == 'pro'
        assert [row['id'] for row in entitlement['subscriptions']] == [external.id]
        assert external.status == 'active'
        assert native.status == 'expired'
        db.commit()


def test_subscription_reference_cannot_cross_members_or_providers(client):
    from app.modules.billing import service
    from app.core.errors import ApiError
    a, b = member(client, 'ref-owner'), member(client, 'ref-thief')
    with session_factory()() as db:
        service.activate_subscription(db, a.id, 'pro', 'payments', 'owned-reference')
        db.commit()
    for owner, provider in ((b.id, 'payments'), (a.id, 'app_store')):
        with session_factory()() as db, pytest.raises(ApiError):
            service.activate_subscription(db, owner, 'pro', provider, 'owned-reference')


def test_concurrent_same_member_reconcile_is_idempotent_and_preserves_other_provider(client, provider):
    from concurrent.futures import ThreadPoolExecutor
    from app.modules.billing import service
    from app.models.account import Member
    a = member(client, 'rc-parallel')
    with session_factory()() as db:
        service.activate_subscription(db, a.id, 'concierge', 'payments', 'external-' + a.id)
        db.commit()
    def reconcile(_):
        with session_factory()() as db:
            result = revenuecat.sync(db, db.get(Member, a.id))
            db.commit()
            return result['entitlements']['plan']
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(reconcile, range(2))) == ['concierge', 'concierge']
    with session_factory()() as db:
        rows = db.scalars(select(Subscription).where(Subscription.member_id == a.id)).all()
        assert len(rows) == 2
        assert all(row.status == 'active' for row in rows)
        assert db.scalar(select(func.count()).select_from(StorePurchase).where(StorePurchase.member_id == a.id)) == 1


def test_paid_member_cannot_create_another_checkout(client, provider):
    a = member(client, 'rc-no-second-checkout')
    assert a.post('/subscriptions/store-sync').status_code == 200
    response = a.post('/subscriptions/checkout', json={'plan': 'concierge', 'cadence': 'monthly'})
    assert response.status_code == 409, response.text

@pytest.mark.parametrize('field', ['aliases', 'original_app_user_id'])
@pytest.mark.parametrize('change', ['refund', 'renewal'])
def test_anonymous_webhook_resolves_known_identity_without_linking_accounts(client, provider, monkeypatch, field, change):
    data, requests = provider
    a = member(client, 'rc-alias-' + uuid.uuid4().hex)
    assert a.post('/subscriptions/store-sync').status_code == 200
    monkeypatch.setattr(get_settings(), 'revenuecat_webhook_authorization', 'test-alias-auth')
    if change == 'refund':
        data['pro_monthly']['refunded_at'] = utcnow().isoformat()
    else:
        data['pro_monthly']['expires_date'] = (utcnow() + timedelta(days=90)).isoformat()
    event = {'app_user_id': '$RCAnonymousID:unknown', field: [a.id, a.id, 'unknown-identity'] if field == 'aliases' else a.id, 'plan': 'concierge'}
    before = len(requests)
    response = client.post('/v1/webhooks/revenuecat', json={'event': event}, headers={'Authorization': 'test-alias-auth'})
    assert response.status_code == 200, response.text
    assert len(requests) == before + 1
    assert requests[-1].url.path.endswith('/' + a.id)
    with session_factory()() as db:
        sub = db.scalar(select(Subscription).where(Subscription.member_id == a.id))
        assert sub.status == ('expired' if change == 'refund' else 'active')
        if change == 'renewal':
            assert sub.current_period_end > utcnow() + timedelta(days=89)


def test_unknown_and_malformed_aliases_never_create_or_reconcile_members(client, provider, monkeypatch):
    _, requests = provider
    monkeypatch.setattr(get_settings(), 'revenuecat_webhook_authorization', 'test-alias-auth')
    for aliases, expected in [(['unknown-member'], 200), ('not-an-array', 422)]:
        response = client.post('/v1/webhooks/revenuecat', json={'event': {'app_user_id': '$RCAnonymousID:unknown', 'aliases': aliases}}, headers={'Authorization': 'test-alias-auth'})
        assert response.status_code == expected, response.text
    assert not requests


def test_concurrent_cross_member_receipt_claim_has_one_owner(client, provider):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from app.models.account import Member
    from app.core.errors import ApiError
    a, b = member(client, 'rc-race-owner-a'), member(client, 'rc-race-owner-b')
    barrier = Barrier(2)
    def claim(member_id):
        with session_factory()() as db:
            user = db.get(Member, member_id)
            barrier.wait(timeout=10)
            try:
                result = revenuecat.sync(db, user)
                db.commit()
                return result['status']
            except ApiError:
                db.rollback()
                return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(claim, [a.id, b.id])) == ['conflict', 'granted']
    with session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(StorePurchase).where(StorePurchase.member_id.in_([a.id, b.id]))) == 1
        assert db.scalar(select(func.count()).select_from(Subscription).where(Subscription.member_id.in_([a.id, b.id]))) == 1

@pytest.mark.parametrize('independent_provider', [None, 'payments', 'app_store'])
def test_direct_receipt_migrates_once_and_refund_cannot_leave_duplicate_access(client, provider, monkeypatch, independent_provider):
    from app.modules.billing import service, stores
    data, _ = provider
    a = member(client, 'rc-migrate-' + uuid.uuid4().hex)
    tx = 'apple-migration-' + a.id
    data['pro_monthly']['store'] = 'app_store'
    data['pro_monthly']['store_transaction_id'] = tx
    monkeypatch.setattr(get_settings(), 'store_validation', 'app_store')
    monkeypatch.setattr(stores, 'missing_configuration', lambda mode: None)
    monkeypatch.setattr(stores, 'verify', lambda *args: stores.VerifiedReceipt('pro_monthly', tx, utcnow() + timedelta(days=30), 'production'))
    from tests.test_store_receipts import legacy_receipt
    legacy_receipt(a, transaction_id=tx)
    body = {'store': 'app_store', 'product_id': 'pro_monthly', 'transaction_id': tx}
    assert a.post('/subscriptions/store-purchase', json=body).json()['entitlements']['paid']
    independent_id = None
    with session_factory()() as db:
        direct = db.scalar(select(Subscription).where(Subscription.member_id == a.id))
        direct_id = direct.id
        if independent_provider:
            independent = service.activate_subscription(db, a.id, 'concierge', independent_provider, 'separate-' + a.id, period_end=utcnow() + timedelta(days=60))
            independent_id = independent.id
        db.commit()
    monkeypatch.setattr(get_settings(), 'store_validation', 'revenuecat')
    assert a.post('/subscriptions/store-sync').status_code == 200
    # Replay migration must neither grant twice nor resurrect the direct grant.
    assert a.post('/subscriptions/store-sync').status_code == 200
    with session_factory()() as db:
        receipt = db.scalar(select(StorePurchase).where(StorePurchase.store == 'app_store', StorePurchase.transaction_id == tx))
        assert receipt.subscription_id != direct_id
        assert db.get(Subscription, direct_id).status == 'expired'
        assert db.get(Subscription, receipt.subscription_id).provider == 'revenuecat'
        assert db.scalar(select(func.count()).select_from(StorePurchase).where(StorePurchase.member_id == a.id)) == 1
    data['pro_monthly']['refunded_at'] = utcnow().isoformat()
    result = a.post('/subscriptions/store-sync').json()['entitlements']
    assert result['paid'] is bool(independent_provider)
    assert result['plan'] == ('concierge' if independent_provider else 'free')
    with session_factory()() as db:
        assert db.get(Subscription, direct_id).status == 'expired'
        if independent_id:
            assert db.get(Subscription, independent_id).status == 'active'


def test_first_revenuecat_snapshot_already_refunded_retires_only_matched_direct_grant(client, provider):
    from app.modules.billing import service
    data, _ = provider
    a = member(client, 'rc-first-refund')
    tx = data['pro_monthly']['store_transaction_id']
    with session_factory()() as db:
        direct = service.activate_subscription(db, a.id, 'pro', 'play_store', 'play_store:' + tx, period_end=utcnow() + timedelta(days=30))
        db.add(StorePurchase(member_id=a.id, store='play_store', product_id='pro_monthly', transaction_id=tx, plan='pro', cadence='monthly', status='granted', validated_by='play_store', subscription_id=direct.id))
        db.commit()
    data['pro_monthly']['refunded_at'] = utcnow().isoformat()
    result = a.post('/subscriptions/store-sync')
    assert result.status_code == 200, result.text
    assert not result.json()['entitlements']['paid']


def test_failed_migration_rolls_back_retirement_of_the_direct_grant(client, provider):
    from tests.test_store_receipts import legacy_receipt
    data, _ = provider
    a, b = member(client, 'rc-atomic-a'), member(client, 'rc-atomic-b')
    tx = legacy_receipt(a, store='play_store')
    data['pro_monthly']['store_transaction_id'] = tx
    data['pro_annual'] = {**data['pro_monthly'], 'store_transaction_id': 'foreign-' + b.id}
    with session_factory()() as db:
        original = db.scalar(select(StorePurchase).where(StorePurchase.transaction_id == tx))
        original_sub = original.subscription_id
        db.add(StorePurchase(member_id=b.id, store='play_store', product_id='pro_annual', transaction_id='foreign-' + b.id, plan='pro', cadence='annual', status='granted', validated_by='play_store'))
        db.commit()
    assert a.post('/subscriptions/store-sync').status_code == 409
    with session_factory()() as db:
        assert db.get(Subscription, original_sub).status == 'active'
        receipt = db.scalar(select(StorePurchase).where(StorePurchase.transaction_id == tx))
        assert receipt.subscription_id == original_sub
        assert receipt.validated_by == 'play_store'
