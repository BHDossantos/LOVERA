"""Changing plan: the upgrade has to be possible, and it must not bill twice.

Two requirements pull in opposite directions, and the code has at various points satisfied one
by breaking the other.

**Nobody is billed twice.** `activate_subscription` used to cancel *every* active subscription
for the member whenever any new one started. For two subscriptions billed by the same provider
that is roughly right; across providers it was a serious bug, because a member with a Stripe
subscription who bought on iOS had the Stripe row marked cancelled in our database while Stripe
carried on charging them. Our row is not what Stripe bills from, and it is certainly not what
Apple bills from.

**The member can change plan.** Fixing the first by refusing checkout whenever anything is
active closed the only route there is: `POST /subscriptions/checkout` is the sole way to buy on
the web, there is no change-plan endpoint, and so Pro could never become Concierge and monthly
could never become annual — the whole paid ladder, including the annual term, unreachable to
anyone who had already bought anything. Nothing in the suite noticed, which is why this file
exists.

What is true now: within our own checkout a new subscription supersedes the one it replaces, the
same way pressing Cancel would — the old plan runs to the end of the period already paid for and
then lapses. Across providers nothing is touched, because we cannot stop a store charging
anybody; a member who subscribed in a store is told to change it there rather than quietly
given a second subscription.
"""
from __future__ import annotations

import uuid

from app.models.billing import Subscription

from tests.conftest import Actor, subscribe, unique_email


def billing_member(client, prefix: str) -> Actor:
    """Signed in and nothing more — billing takes `current_principal`, not `active_member`.

    Full onboarding would put these members into the shared matching pool and turn unrelated
    introduction tests red, which is how the same helper came to exist in test_pricing.py.
    """
    a = Actor(client, unique_email(prefix))
    a.sign_in()
    return a


def checkout(actor: Actor, plan: str, cadence: str = "monthly"):
    return actor.post(
        "/subscriptions/checkout",
        json={"plan": plan, "cadence": cadence},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )


def subscriptions_of(member_id: str) -> list[Subscription]:
    from app.core.db import session_factory
    from sqlalchemy import select

    db = session_factory()()
    try:
        return list(db.scalars(select(Subscription).where(Subscription.member_id == member_id)).all())
    finally:
        db.close()


# --------------------------------------------------------------------------------------------
# The ladder works
# --------------------------------------------------------------------------------------------


def test_a_pro_member_can_buy_concierge(client):
    """€39 becoming €89 is the product's main upsell. It returned 409."""
    a = billing_member(client, "upgrade-tier")
    subscribe(a, plan="pro", cadence="monthly")

    r = checkout(a, "concierge")
    assert r.status_code == 200, r.text

    ref = r.json()["provider_ref"]
    assert a.post("/subscriptions/sandbox/pay", json={"checkout_ref": ref, "outcome": "paid"}).status_code == 200
    assert a.get("/subscriptions/current").json()["entitlements"]["plan"] == "concierge"


def test_a_monthly_member_can_move_to_annual(client):
    """The annual term exists to be sold to people already paying monthly."""
    a = billing_member(client, "upgrade-cadence")
    subscribe(a, plan="pro", cadence="monthly")

    r = checkout(a, "pro", cadence="annual")
    assert r.status_code == 200, r.text

    ref = r.json()["provider_ref"]
    assert a.post("/subscriptions/sandbox/pay", json={"checkout_ref": ref, "outcome": "paid"}).status_code == 200
    assert a.get("/subscriptions/current").json()["entitlements"]["plan"] == "pro"


# --------------------------------------------------------------------------------------------
# And it does not bill twice
# --------------------------------------------------------------------------------------------


def test_the_replaced_subscription_stops_renewing(client):
    """Otherwise the upgrade is just a second charge.

    It is cancelled *at period end* rather than immediately: they paid for that period, and
    taking it away the moment they spend more money would be an odd way to thank them.
    """
    a = billing_member(client, "upgrade-supersede")
    subscribe(a, plan="pro", cadence="monthly")
    old_id = next(s.id for s in subscriptions_of(a.id) if s.plan == "pro")

    ref = checkout(a, "concierge").json()["provider_ref"]
    a.post("/subscriptions/sandbox/pay", json={"checkout_ref": ref, "outcome": "paid"})

    rows = {s.id: s for s in subscriptions_of(a.id)}
    assert rows[old_id].cancel_at_period_end is True
    assert rows[old_id].cancel_reason == "superseded"
    new = next(s for s in rows.values() if s.plan == "concierge")
    assert new.cancel_at_period_end is False


def test_buying_the_plan_you_are_already_on_is_refused(client):
    """Not an upgrade — just a second charge for the same thing."""
    a = billing_member(client, "upgrade-same")
    subscribe(a, plan="pro", cadence="monthly")

    r = checkout(a, "pro", cadence="monthly")
    assert r.status_code == 409, r.text
    assert "already on this plan" in r.json()["error"]["message"]


# --------------------------------------------------------------------------------------------
# Across providers, we keep our hands off
# --------------------------------------------------------------------------------------------


def test_a_store_subscriber_is_sent_to_the_store(client, monkeypatch):
    """We cannot change or stop an Apple subscription, so selling alongside one bills twice."""
    from app.core import config
    from app.modules.billing import service

    a = billing_member(client, "upgrade-store")
    from app.core.db import session_factory

    db = session_factory()()
    try:
        service.activate_subscription(db, a.id, "pro", "app_store", f"app_store:{uuid.uuid4().hex}")
        db.commit()
    finally:
        db.close()

    r = checkout(a, "concierge")
    assert r.status_code == 409, r.text
    assert "App Store" in r.json()["error"]["message"]


def test_our_own_checkout_never_touches_a_store_subscription(client):
    """The bug that started all of this: a web purchase marking an Apple row cancelled.

    Our row is not what Apple bills from, so writing to it changes nothing except our own
    belief about what the member has — which is the worst of both worlds.
    """
    from app.modules.billing import service
    from app.core.db import session_factory

    a = billing_member(client, "upgrade-crossprovider")
    db = session_factory()()
    try:
        store_sub = service.activate_subscription(db, a.id, "pro", "app_store", f"app_store:{uuid.uuid4().hex}")
        store_id = store_sub.id
        # A second, independently billed subscription through our own checkout.
        service.activate_subscription(db, a.id, "concierge", "sandbox", f"sub_{uuid.uuid4().hex}")
        db.commit()
    finally:
        db.close()

    rows = {s.id: s for s in subscriptions_of(a.id)}
    assert rows[store_id].status == "active"
    assert rows[store_id].cancel_at_period_end is False
    assert rows[store_id].cancelled_at is None
