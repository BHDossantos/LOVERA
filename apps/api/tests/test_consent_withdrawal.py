"""What withdrawing special-category consent has to do everywhere, not only in the matcher.

`build_snapshot` already drops a sensitive signal and a sensitive preference once consent is
revoked, so nothing is scored or gated by them. That is invisible to the member: the preference
screen kept reporting the stored row with its tier, so somebody who had withdrawn consent was
told a Must criterion was still gating their introductions while they were shown people it
excludes, and the impact preview counted that gate too — so the number they were comparing
against was a baseline that does not exist.
"""
from __future__ import annotations

from tests.conftest import Actor, onboard, unique_email

# Barcelona, not Rome: these members would otherwise join the pool every journey test's batch
# allocates from, and an extra candidate there changes who gets paired with whom. The tests here
# are about consent and about corrections, not about allocation, so they get their own market.
CITY = "barcelona"
ZONE = "barcelona:eixample"


def _sensitive_preference_key() -> tuple[str, str]:
    from app.catalog.signals import PREFERENCES, SIGNALS

    key = next(k for k, p in PREFERENCES.items() if (SIGNALS.get(p.target) and SIGNALS[p.target].special_category))
    return key, next(iter(SIGNALS[PREFERENCES[key].target].options))


def test_a_withdrawn_sensitive_preference_is_reported_as_not_in_use(client):
    key, value = _sensitive_preference_key()
    a = Actor(client, unique_email("ana-inactive"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", city=CITY, zone=ZONE, faith_consent=True)
    assert a.patch(f"/preferences/{key}", json={"tier": "must", "value": {"in": [value]}}).status_code == 200

    row = next(p for p in a.get("/preferences").json()["preferences"] if p["key"] == key)
    assert row["active"] is True and row["inactive_reason"] is None

    a.put("/consents/special_category", json={"status": "revoked", "policy_version": "2026-01-01"})
    row = next(p for p in a.get("/preferences").json()["preferences"] if p["key"] == key)
    # The row stays, and keeps its tier: granting consent again has to restore the member's own
    # setting rather than silently make them re-enter it. What changes is the claim that it is
    # being enforced, because it is not.
    assert row["tier"] == "must"
    assert row["active"] is False, "a criterion the matcher ignores must not be shown as enforced"
    assert row["inactive_reason"] == "special_category_consent_withdrawn"

    # A non-sensitive criterion is untouched by any of this.
    others = [p for p in a.get("/preferences").json()["preferences"] if p["key"] != key]
    assert others and all(p["active"] is True for p in others)

    # And the Blueprint payload carries the same objects, because its own summary of the member's
    # criteria renders from them — typed without `active`, that summary went on calling this a Must
    # one tap away from the page that says it is not in use.
    bp = next(p for p in a.get("/blueprint/current").json()["preferences"] if p["key"] == key)
    assert bp["active"] is False
    assert bp["inactive_reason"] == "special_category_consent_withdrawn"


def test_the_impact_preview_refuses_a_preference_the_save_would_refuse(client):
    key, value = _sensitive_preference_key()
    a = Actor(client, unique_email("ana-preview"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", city=CITY, zone=ZONE, faith_consent=True)
    ok = a.post("/preferences/impact-preview", json={"key": key, "tier": "must", "value": {"in": [value]}})
    assert ok.status_code == 200, ok.text

    a.put("/consents/special_category", json={"status": "revoked", "policy_version": "2026-01-01"})
    r = a.post("/preferences/impact-preview", json={"key": key, "tier": "must", "value": {"in": [value]}})
    # upsert_preference already refuses this save, so a preview of it was a preview of a 403.
    assert r.status_code == 403, r.text
    assert r.json()["error"]["consent_required"] == "special_category"

    # Open is refused too, and so is its preview: build_snapshot drops a sensitive preference at
    # every tier, so Open is processing special-category data as much as Must is.
    assert a.post("/preferences/impact-preview", json={"key": key, "tier": "open", "value": {"in": [value]}}).status_code == 403


def test_a_correction_with_no_replacement_reaches_a_reviewer(client):
    """The member is told "noted for a reviewer", which was true of the row and false of the
    product: `IntroCorrection` was written here and read by nothing, so no reviewer could ever
    see what they said. This is the endpoint that makes the promise keepable."""
    from tests.conftest import staff

    a = Actor(client, unique_email("ana-corr"))
    b = Actor(client, unique_email("bruno-corr"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", city=CITY, zone=ZONE)
    onboard(b, gender="man", seeking=["woman"], name="Bruno", city=CITY, zone=ZONE)
    concierge = staff(client, "concierge@example.test")
    r = concierge.post("/admin/matching/runs", json={"market_id": CITY, "auto_publish": True})
    assert r.status_code == 201, r.text
    # Whichever of the two the batch served: other tests in this module leave members in the
    # same market, so who gets paired with whom is not ours to fix, and this test is about the
    # correction rather than the allocation.
    a = next((actor for actor in (a, b) if actor.get("/introductions").json()["current"]), None)
    assert a, "the batch has to produce an introduction for this to be correctable"
    intro = a.get("/introductions").json()["current"][0]["id"]

    r = a.post(f"/introductions/{intro}/correction", json={"signal_key": "life_plan.children", "value": None, "note": "Not even close."})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied"] is False and "has not changed" in body["message"]

    items = concierge.get("/admin/matching/corrections?unapplied_only=true").json()["items"]
    mine = [c for c in items if c["introduction_id"] == intro]
    assert mine, "a correction nothing acted on must be readable by the person it was promised to"
    assert mine[0]["note"] == "Not even close."
    assert mine[0]["applied"] is False
    assert mine[0]["signal_label"], "a reviewer reads labels, not catalog keys"


def test_a_sensitive_preference_cannot_be_saved_at_any_tier_without_consent(client):
    """Open is not a lesser kind of processing.

    `build_snapshot` drops a sensitive preference at every tier, so an Open one saved without
    consent accomplished exactly one thing: it recorded, about somebody who had declined to let
    us hold it, that faith is a criterion for them. That is the collection the consent governs.
    """
    key, value = _sensitive_preference_key()
    a = Actor(client, unique_email("ana-open"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", city=CITY, zone=ZONE)

    for tier in ("must", "prefer", "open"):
        r = a.patch(f"/preferences/{key}", json={"tier": tier, "value": {"in": [value]}})
        assert r.status_code == 403, f"{tier}: {r.text}"
        assert r.json()["error"]["consent_required"] == "special_category"

    # And it is not offered, because a control whose one outcome is a 403 is its own kind of wrong.
    payload = a.get("/preferences").json()
    assert key not in {p["key"] for p in payload["available"]}
    assert key not in {p["key"] for p in payload["preferences"]}

    # With consent it is offered and accepted, at every tier.
    a.put("/consents/special_category", json={"status": "granted", "policy_version": "2026-01-01"})
    assert key in {p["key"] for p in a.get("/preferences").json()["available"]}
    assert a.patch(f"/preferences/{key}", json={"tier": "open", "value": {"in": [value]}}).status_code == 200
