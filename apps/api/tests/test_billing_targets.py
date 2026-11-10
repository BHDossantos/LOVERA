"""Focused ORM regression checks; PostgreSQL/HTTP coverage lives in test_plan_changes.

SQLite does not preserve timezone metadata, so the local clock is normalized only in these tests.
No production provider calls or charges occur.
"""
from datetime import datetime, timedelta, timezone
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.core.errors import ApiError
from app.models import Base
from app.models.account import Member
from app.models.billing import Subscription
from app.modules.billing import service


@compiles(JSONB, "sqlite")
def sqlite_jsonb(type_, compiler, **kwargs):
    return "JSON"


@pytest.fixture
def local(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    settings = Settings(env="test", payments_provider="sandbox", mail_transport="console", ai_provider="deterministic")
    monkeypatch.setattr(service, "get_settings", lambda: settings)
    monkeypatch.setattr(service, "utcnow", lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    with sessions() as db:
        member = Member(email=f"regression-{uuid.uuid4().hex}@example.test", email_hash=uuid.uuid4().hex)
        db.add(member)
        db.commit()
        member_id = member.id
    yield sessions, member_id
    engine.dispose()


def activate(db, member_id, plan="pro", provider="sandbox", **kwargs):
    return service.activate_subscription(db, member_id, plan, provider, uuid.uuid4().hex, **kwargs)


@pytest.mark.parametrize("provider", ["app_store", "play_store", "revenuecat"])
def test_expired_store_does_not_block_checkout_after_rollback(local, provider):
    sessions, member_id = local
    with sessions() as db:
        old = activate(db, member_id, provider=provider, period_end=service.utcnow()-timedelta(days=1))
        old_id = old.id
        db.commit()
    # First request rolls back for an unrelated downstream failure. Retry must still succeed.
    for commit in (False, True):
        with sessions() as db:
            result = service.create_checkout(db, db.get(Member, member_id), "concierge", uuid.uuid4().hex)
            assert result["plan"] == "concierge"
            db.commit() if commit else db.rollback()
    with sessions() as db:
        assert db.get(Subscription, old_id).status == "expired"


@pytest.mark.parametrize("old_plan,new_plan,cadence", [("concierge", "pro", "monthly"), ("pro", "concierge", "monthly"), ("pro", "pro", "annual")])
def test_cancel_targets_renewing_subscription_not_best_entitlement(local, old_plan, new_plan, cadence):
    sessions, member_id = local
    with sessions() as db:
        old = activate(db, member_id, old_plan)
        old_id = old.id
        db.commit()
    with sessions() as db:
        new = activate(db, member_id, new_plan, cadence=cadence)
        new_id = new.id
        db.commit()
    for _ in range(2):
        with sessions() as db:
            member = db.get(Member, member_id)
            target = service.entitlements_for(db, member)["cancellation_target"]
            if target:
                assert target["id"] == new_id
            result = service.cancel(db, member, "taking_a_break", new_id)
            assert result["cancellation_target"] is None
            assert result["paid"] is True
            db.commit()
    with sessions() as db:
        assert db.get(Subscription, old_id).cancel_at_period_end is True
        assert db.get(Subscription, new_id).cancel_at_period_end is True


def test_legacy_cancel_also_targets_renewing_web_subscription(local):
    sessions, member_id = local
    with sessions() as db:
        activate(db, member_id, "concierge")
        new = activate(db, member_id, "pro")
        new_id = new.id
        db.commit()
    with sessions() as db:
        service.cancel(db, db.get(Member, member_id), None)
        db.commit()
    with sessions() as db:
        assert db.get(Subscription, new_id).cancel_at_period_end


def test_cancel_web_does_not_change_separate_store_subscription(local):
    sessions, member_id = local
    with sessions() as db:
        store = activate(db, member_id, "concierge", "app_store")
        store_id = store.id
        web = activate(db, member_id, "pro")
        web_id = web.id
        db.commit()
    with sessions() as db:
        member = db.get(Member, member_id)
        ent = service.entitlements_for(db, member)
        assert ent["plan"] == "concierge"
        assert ent["cancellation_target"]["id"] == web_id
        service.cancel(db, member, None, web_id)
        db.commit()
    with sessions() as db:
        assert not db.get(Subscription, store_id).cancel_at_period_end
        assert db.get(Subscription, web_id).cancel_at_period_end


def test_explicit_cancel_refuses_store_and_other_members_rows(local):
    sessions, member_id = local
    with sessions() as db:
        store = activate(db, member_id, provider="app_store")
        store_id = store.id
        db.commit()
    for target in (store_id, "not-this-members-subscription"):
        with sessions() as db:
            with pytest.raises(ApiError):
                service.cancel(db, db.get(Member, member_id), None, target)
            db.rollback()
    with sessions() as db:
        assert not db.get(Subscription, store_id).cancel_at_period_end
