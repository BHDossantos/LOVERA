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
