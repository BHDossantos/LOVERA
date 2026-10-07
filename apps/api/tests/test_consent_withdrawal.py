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


def _sensitive_preference_key() -> tuple[str, str]:
    from app.catalog.signals import PREFERENCES, SIGNALS

    key = next(k for k, p in PREFERENCES.items() if (SIGNALS.get(p.target) and SIGNALS[p.target].special_category))
    return key, next(iter(SIGNALS[PREFERENCES[key].target].options))


def test_a_withdrawn_sensitive_preference_is_reported_as_not_in_use(client):
    key, value = _sensitive_preference_key()
    a = Actor(client, unique_email("ana-inactive"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", zone="rome:prati", faith_consent=True)
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


def test_the_impact_preview_refuses_a_preference_the_save_would_refuse(client):
    key, value = _sensitive_preference_key()
    a = Actor(client, unique_email("ana-preview"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", zone="rome:prati", faith_consent=True)
    ok = a.post("/preferences/impact-preview", json={"key": key, "tier": "must", "value": {"in": [value]}})
    assert ok.status_code == 200, ok.text

    a.put("/consents/special_category", json={"status": "revoked", "policy_version": "2026-01-01"})
    r = a.post("/preferences/impact-preview", json={"key": key, "tier": "must", "value": {"in": [value]}})
    # upsert_preference already refuses this save, so a preview of it was a preview of a 403.
    assert r.status_code == 403, r.text
    assert r.json()["error"]["consent_required"] == "special_category"

    # Open is still previewable, because upsert_preference still accepts that save. It is not a
    # gate, so the number does not move — and the preference it saves is reported inactive, since
    # build_snapshot drops a sensitive preference at every tier.
    preview = a.post("/preferences/impact-preview", json={"key": key, "tier": "open", "value": {"in": [value]}})
    assert preview.status_code == 200, preview.text
    assert a.patch(f"/preferences/{key}", json={"tier": "open", "value": {"in": [value]}}).status_code == 200
    row = next(p for p in a.get("/preferences").json()["preferences"] if p["key"] == key)
    assert row["active"] is False, "Open is processing too, and consent is its lawful basis as much as Must's"


def test_a_correction_with_no_replacement_reaches_a_reviewer(client):
    """The member is told "noted for a reviewer", which was true of the row and false of the
    product: `IntroCorrection` was written here and read by nothing, so no reviewer could ever
    see what they said. This is the endpoint that makes the promise keepable."""
    from tests.test_journey import run_batch

    a = Actor(client, unique_email("ana-corr"))
    b = Actor(client, unique_email("bruno-corr"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", zone="rome:prati")
    onboard(b, gender="man", seeking=["woman"], name="Bruno", zone="rome:prati")
    concierge, _ = run_batch(client)
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
