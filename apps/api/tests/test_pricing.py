"""The pricing ladder: what each tier grants, and what an annual term actually buys.

Two defects made this file necessary, and both are the same shape — two things that must agree,
computed separately.

**Concierge sold nothing.** `PLANS["concierge"]["included"]` promised "periodic human matchmaker
review" and "priority date coordination". `entitlements_for` computed every feature flag as
`plan in PAID_PLANS`. The bullets and the flags had no connection, so Concierge granted
byte-for-byte what Pro granted, at €89 against €39. Nothing failed, no test covered it, and the
only way to notice was to read the two files side by side.

**Annual renewed monthly.** `activate_subscription` took `period_days: int = 30` and every caller
took the default. The catalog said `"cadence": "monthly"` on all three plans, so there was no
annual option to get wrong — but the first one added would have been charged for a year and
renewed in a month.

The first group of tests below pins the catalog so a feature can never be advertised without
being granted. The second pins the term so a year is a year.
"""
from __future__ import annotations

import uuid

import pytest

from app.catalog.plans import (
    ALWAYS_INCLUDED,
    CADENCES,
    FEATURES,
    NEVER_SOLD,
    PAID_PLANS,
    PERIOD_DAYS,
    PLANS,
    annual_saving_cents,
    grants,
    included_for,
    monthly_equivalent_cents,
    not_included_for,
    price_cents,
)

from tests.conftest import Actor, subscribe, unique_email


# --------------------------------------------------------------------------------------------
# The catalog itself. No database, no client: these are properties of the declaration.
# --------------------------------------------------------------------------------------------
def test_every_bullet_traces_to_a_feature_or_an_always_included_line():
    """The property that was missing. A sentence a member reads must be backed by something."""
    allowed = set(FEATURES.values()) | set(ALWAYS_INCLUDED)
    for plan_id in PLANS:
        for line in included_for(plan_id):
            assert line in allowed, f"{plan_id} advertises {line!r}, which no feature grants"


def test_a_plan_advertises_exactly_what_it_grants():
    for plan_id in PLANS:
        advertised = {line for line in included_for(plan_id) if line in set(FEATURES.values())}
        granted = {FEATURES[k] for k in FEATURES if grants(plan_id, k)}
        assert advertised == granted, f"{plan_id} advertises {advertised ^ granted}"


def test_not_included_names_the_gap_and_the_things_nobody_can_buy():
    free = not_included_for("free")
    assert FEATURES["ai_wingman"] in free
    for line in NEVER_SOLD:
        assert line in free
        # The refusal to sell reach is stated on the top tier too, where it means the most.
        assert line in not_included_for("concierge")


def test_the_top_tier_grants_strictly_more_than_the_one_below_it():
    """What €89 buys that €39 does not. This assertion is the whole point of the file."""
    pro = set(PLANS["pro"]["features"])
    concierge = set(PLANS["concierge"]["features"])
    assert pro < concierge, "Concierge must grant everything Pro does and then some"
    assert concierge - pro == {"human_review", "priority_coordination"}


def test_a_higher_price_never_buys_the_same_thing():
    ladder = sorted(PAID_PLANS, key=lambda p: price_cents(p, "monthly"))
    for cheaper, dearer in zip(ladder, ladder[1:]):
        assert price_cents(dearer, "monthly") > price_cents(cheaper, "monthly")
        assert set(PLANS[dearer]["features"]) > set(PLANS[cheaper]["features"])


@pytest.mark.parametrize("plan_id", PAID_PLANS)
def test_annual_is_ten_months_for_twelve_and_says_so_in_money(plan_id: str):
    monthly = price_cents(plan_id, "monthly")
    assert price_cents(plan_id, "annual") == monthly * 10
    assert annual_saving_cents(plan_id) == monthly * 2
    # The per-month equivalent is what makes the two comparable at a glance, and it has to be the
    # real division rather than the headline monthly price.
    assert monthly_equivalent_cents(plan_id, "annual") == round(monthly * 10 / 12)
    assert monthly_equivalent_cents(plan_id, "annual") < monthly


def test_free_is_free_on_both_cadences():
    for c in CADENCES:
        assert price_cents("free", c) == 0
    assert annual_saving_cents("free") == 0



def billing_member(client, prefix: str, name: str) -> Actor:
    """A signed-in member, and deliberately nothing more.

    Billing needs an authenticated principal and no onboarding at all — `/plans`,
    `/subscriptions/checkout` and `/subscriptions/current` all take `current_principal` rather
    than `active_member`. Running these through full onboarding put nine extra women seeking men
    into the shared matching pool, which starved `mutual_pair` of the man it was trying to
    introduce and turned five read-receipt tests red: a failure in a suite with nothing to do
    with pricing, which is the worst kind to debug. `date_ready: False` was not enough, because
    readiness only down-weights a candidate in scoring and never excludes them.

    `name` is kept in the signature so each member is still identifiable in a failure.
    """
    a = Actor(client, unique_email(prefix))
    a.sign_in()
    return a


# --------------------------------------------------------------------------------------------
# The term, end to end through checkout and the payment webhook.
# --------------------------------------------------------------------------------------------
def test_annual_checkout_charges_the_annual_price(client):
    a = billing_member(client, "annual-price", "Annual Price")
    r = a.post("/subscriptions/checkout", json={"plan": "pro", "cadence": "annual"}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cadence"] == "annual"
    assert body["price_cents"] == price_cents("pro", "annual")
    assert body["period_days"] == PERIOD_DAYS["annual"]


def test_an_annual_subscription_renews_in_a_year_not_a_month(client):
    """`period_days` defaulted to 30 for every caller, so this is the regression that mattered."""
    a = billing_member(client, "annual-term", "Annual Term")
    subscribe(a, "pro", cadence="annual")

    ent = a.get("/subscriptions/current").json()["entitlements"]
    assert ent["cadence"] == "annual"
    assert ent["price_cents"] == price_cents("pro", "annual")

    from datetime import datetime, timezone

    renews = datetime.fromisoformat(ent["renews_at"].replace("Z", "+00:00"))
    days = (renews - datetime.now(timezone.utc)).days
    assert days > 300, f"an annual term renewed in {days} days"


def test_a_monthly_subscription_still_renews_in_a_month(client):
    a = billing_member(client, "monthly-term", "Monthly Term")
    subscribe(a, "pro", cadence="monthly")

    ent = a.get("/subscriptions/current").json()["entitlements"]
    assert ent["cadence"] == "monthly"

    from datetime import datetime, timezone

    renews = datetime.fromisoformat(ent["renews_at"].replace("Z", "+00:00"))
    assert 20 < (renews - datetime.now(timezone.utc)).days < 40


def test_concierge_entitlements_differ_from_pro_through_the_api(client):
    """Read back through `/subscriptions/current`, which is what the two clients actually see."""
    pro = billing_member(client, "tier-pro", "Tier Pro")
    subscribe(pro, "pro")
    con = billing_member(client, "tier-con", "Tier Concierge")
    subscribe(con, "concierge")

    p = pro.get("/subscriptions/current").json()["entitlements"]
    c = con.get("/subscriptions/current").json()["entitlements"]

    assert p["human_review"] is False and c["human_review"] is True
    assert p["priority_coordination"] is False and c["priority_coordination"] is True
    # Everything Pro has, Concierge has. `protected_credits` is excluded because it is the only
    # key in FEATURES whose entitlement value is deliberately overwritten by a count — the flag
    # for it is `earns_protected_credits`, and both tiers carry it.
    for key in FEATURES:
        if key == "protected_credits":
            continue
        if p[key]:
            assert c[key], f"Concierge lost {key}, which Pro grants"
    assert p["earns_protected_credits"] is True and c["earns_protected_credits"] is True


def test_a_free_member_is_granted_none_of_the_paid_features(client):
    a = billing_member(client, "tier-free", "Tier Free")
    ent = a.get("/subscriptions/current").json()["entitlements"]
    for key in FEATURES:
        # `protected_credits` is the balance, which is a number and starts at zero; the flag that
        # says whether this plan earns them is separate, and is also off.
        expected = 0 if key == "protected_credits" else False
        assert ent[key] == expected, f"the free plan granted {key}"
    assert ent["earns_protected_credits"] is False
    # But never the safety tools, which are not a tier.
    assert ent["safety_tools"] is True and ent["messaging"] is True


def test_an_unknown_cadence_is_refused_rather_than_silently_billed_monthly(client):
    a = billing_member(client, "bad-cadence", "Bad Cadence")
    r = a.post("/subscriptions/checkout", json={"plan": "pro", "cadence": "weekly"}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["field_errors"] == {"cadence": "invalid"}


def test_plans_endpoint_carries_both_prices_for_every_plan(client):
    a = billing_member(client, "plans", "Plans Reader")
    body = a.get("/plans").json()
    assert body["cadences"] == list(CADENCES)
    for p in body["plans"]:
        for c in CADENCES:
            assert p["prices"][c]["cents"] == price_cents(p["id"], c)
            assert p["prices"][c]["period_days"] == PERIOD_DAYS[c]
        # The legacy fields older clients read still answer, and still answer truthfully.
        assert p["price_cents"] == price_cents(p["id"], "monthly")


def test_repricing_the_catalog_does_not_reprice_an_existing_member(client, monkeypatch):
    """The term is what was agreed, not what we are selling today."""
    a = billing_member(client, "reprice", "Reprice")
    subscribe(a, "pro", cadence="annual")
    agreed = a.get("/subscriptions/current").json()["entitlements"]["price_cents"]

    monkeypatch.setitem(PLANS["pro"]["prices"], "annual", 99900)
    after = a.get("/subscriptions/current").json()["entitlements"]["price_cents"]
    assert after == agreed


# --------------------------------------------------------------------------------------------
# In-app purchase. The endpoint any signed-in member can POST anything to.
# --------------------------------------------------------------------------------------------
def test_store_purchase_is_refused_when_no_validator_is_configured(client, monkeypatch):
    """The default. Fail closed: nobody can buy, rather than everybody buying for nothing."""
    from app.core import config

    a = billing_member(client, "store-off", "Store Off")
    monkeypatch.setattr(config.get_settings(), "store_validation", "disabled", raising=False)
    r = a.post("/subscriptions/store-purchase", json={"store": "app_store", "product_id": "pro_monthly", "transaction_id": uuid.uuid4().hex})
    assert r.status_code == 503, r.text
    assert a.get("/subscriptions/current").json()["entitlements"]["paid"] is False


def test_an_unknown_product_never_becomes_a_plan(client, monkeypatch):
    from app.core import config

    a = billing_member(client, "store-bogus", "Store Bogus")
    monkeypatch.setattr(config.get_settings(), "store_validation", "sandbox", raising=False)
    r = a.post("/subscriptions/store-purchase", json={"store": "app_store", "product_id": "concierge_free_lol", "transaction_id": uuid.uuid4().hex})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["field_errors"] == {"product_id": "unknown"}
    assert a.get("/subscriptions/current").json()["entitlements"]["paid"] is False


def test_a_sandbox_receipt_grants_the_plan_its_product_maps_to(client, monkeypatch):
    from app.core import config

    a = billing_member(client, "store-ok", "Store Ok")
    monkeypatch.setattr(config.get_settings(), "store_validation", "sandbox", raising=False)
    r = a.post("/subscriptions/store-purchase", json={"store": "app_store", "product_id": "concierge_annual", "transaction_id": uuid.uuid4().hex})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "granted"

    ent = a.get("/subscriptions/current").json()["entitlements"]
    assert ent["plan"] == "concierge" and ent["cadence"] == "annual"
    assert ent["human_review"] is True


def test_the_same_receipt_twice_does_not_subscribe_twice(client, monkeypatch):
    """A restore-purchases and a replay are the same request; only one can be a subscription."""
    from app.core import config

    a = billing_member(client, "store-replay", "Store Replay")
    monkeypatch.setattr(config.get_settings(), "store_validation", "sandbox", raising=False)
    tx = uuid.uuid4().hex
    body = {"store": "app_store", "product_id": "pro_monthly", "transaction_id": tx}
    first = a.post("/subscriptions/store-purchase", json=body)
    assert first.status_code == 200 and first.json()["duplicate"] is False
    second = a.post("/subscriptions/store-purchase", json=body)
    assert second.status_code == 200, second.text
    assert second.json()["duplicate"] is True
    assert a.get("/subscriptions/current").json()["entitlements"]["plan"] == "pro"


def test_a_receipt_replayed_by_a_different_member_grants_them_nothing(client, monkeypatch):
    from app.core import config

    a = billing_member(client, "store-owner", "Store Owner")
    b = billing_member(client, "store-thief", "Store Thief")
    monkeypatch.setattr(config.get_settings(), "store_validation", "sandbox", raising=False)
    tx = uuid.uuid4().hex
    body = {"store": "app_store", "product_id": "concierge_monthly", "transaction_id": tx}
    assert a.post("/subscriptions/store-purchase", json=body).status_code == 200
    r = b.post("/subscriptions/store-purchase", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["duplicate"] is True
    assert b.get("/subscriptions/current").json()["entitlements"]["paid"] is False


def test_the_phone_is_told_whether_it_may_offer_a_purchase(client, monkeypatch):
    from app.core import config

    a = billing_member(client, "store-status", "Store Status")
    monkeypatch.setattr(config.get_settings(), "store_validation", "disabled", raising=False)
    off = a.get("/plans").json()["store"]
    assert off["enabled"] is False and off["reason"]

    monkeypatch.setattr(config.get_settings(), "store_validation", "sandbox", raising=False)
    on = a.get("/plans").json()["store"]
    assert on["enabled"] is True
    # Every paid cadence has a product to ask the store for.
    for p in a.get("/plans").json()["plans"]:
        for c in CADENCES:
            pid = p["store_product_ids"][c]
            if p["price_cents"] > 0:
                assert pid in on["products"], f"{p['id']}/{c} has no store product"
