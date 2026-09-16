"""Critical acceptance journeys from the implementation specification, Section 12."""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from app.core.timeutil import utcnow
from tests.conftest import Actor, onboard, staff, subscribe, unique_email


def run_batch(client, publish=True):
    concierge = staff(client, "concierge@example.test")
    r = concierge.post("/admin/matching/runs", json={"market_id": "rome", "auto_publish": publish})
    assert r.status_code == 201, r.text
    return concierge, r.json()


def find_intro_between(actor: Actor, other_id: str):
    r = actor.get("/introductions")
    assert r.status_code == 200, r.text
    for item in r.json()["current"] + r.json()["mutual"]:
        if item["profile"] and item["profile"]["member_id"] == other_id:
            return item
    return None


@pytest.fixture(scope="module")
def pair(client):
    a = Actor(client, unique_email("ana"))
    b = Actor(client, unique_email("ben"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", zone="rome:prati")
    onboard(b, gender="man", seeking=["woman"], name="Ben", zone="rome:centro", birth_year=1990)
    subscribe(a)
    subscribe(b)
    return a, b


def test_verified_onboarding_blocks_under_18(client):
    kid = Actor(client, unique_email("kid"))
    kid.sign_in()
    r = kid.post("/me/adult-consent", json={"birth_date": (utcnow().date() - timedelta(days=17 * 365)).isoformat(), "accept_terms": True, "accept_privacy": True, "accept_community": True})
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    r = kid.post("/verification/sessions")
    assert r.status_code == 403 and r.json()["error"]["code"] == "ONBOARDING_INCOMPLETE"


def test_failed_verification_cannot_proceed(client):
    m = Actor(client, unique_email("failed"))
    m.sign_in()
    r = m.post("/me/adult-consent", json={"birth_date": "1985-01-01", "accept_terms": True, "accept_privacy": True, "accept_community": True})
    ref = m.post("/verification/sessions").json()["session"]["provider_ref"]
    r = m.post("/verification/sandbox/complete", json={"provider_ref": ref, "outcome": "failed", "reason_code": "no_match"})
    assert r.json()["status"] == "failed"
    r = m.get("/introductions")
    assert r.status_code == 403 and r.json()["error"]["code"] == "ONBOARDING_INCOMPLETE"
    r = m.post("/verification/review-request", json={"note": "Lighting was bad"})
    assert r.json()["status"] == "review_required"
    reviewer = staff(client, "safety@example.test")
    q = reviewer.get("/admin/verification/queue").json()["items"]
    vid = next(i["id"] for i in q if i["status"] == "review_required" and i["review_note"] == "Lighting was bad")
    r = reviewer.post(f"/admin/verification/{vid}/review", json={"decision": "approve"})
    assert r.json()["status"] == "verified"
    assert m.get("/me").json()["verification_status"] == "verified"


def test_private_reciprocity_and_mutual_chat(client, pair):
    a, b = pair
    concierge, run = run_batch(client, publish=False)
    assert run["status"] == "review"
    pairs = concierge.get(f"/admin/matching/runs/{run['id']}/pairs").json()["items"]
    assert any({p["member_a"]["id"], p["member_b"]["id"]} == {a.id, b.id} for p in pairs), pairs
    r = concierge.post(f"/admin/matching/runs/{run['id']}/publish")
    assert r.status_code == 200 and r.json()["published"] >= 1
    intro_a = find_intro_between(a, b.id)
    assert intro_a and intro_a["status"] == "offered"
    assert len(intro_a["explanation"]["reasons"]) >= 1 and intro_a["explanation"]["friction"]["text"]
    assert all(r["strength"] in ("strong", "promising", "low_evidence") for r in intro_a["explanation"]["reasons"])
    assert "%" not in str(intro_a["explanation"])
    # A accepts; B sees nothing about it
    key = str(uuid.uuid4())
    r = a.post(f"/introductions/{intro_a['id']}/decision", json={"decision": "accept"}, headers={"Idempotency-Key": key, "If-Match": str(intro_a["version"])})
    assert r.status_code == 202 and r.json()["status"] == "awaiting_other_member" and r.json()["mutual_interest_revealed"] is False
    # idempotent retry returns the same result
    r2 = a.post(f"/introductions/{intro_a['id']}/decision", json={"decision": "accept"}, headers={"Idempotency-Key": key})
    assert r2.status_code == 202 and r2.json()["your_decision"] == "accept"
    intro_b = b.get(f"/introductions/{intro_a['id']}").json()
    assert intro_b["status"] == "offered" and intro_b["your_decision"] is None and intro_b["mutual_interest_revealed"] is False
    assert b.get("/conversations").json()["items"] == []
    r = b.post(f"/introductions/{intro_a['id']}/decision", json={"decision": "accept"}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 202 and r.json()["status"] == "mutual" and r.json()["conversation_id"]
    conv_id = r.json()["conversation_id"]
    assert len(a.get("/conversations").json()["items"]) == 1
    assert a.get("/conversations").json()["items"][0]["id"] == conv_id
    # Stale version rejected
    r = b.post(f"/introductions/{intro_a['id']}/decision", json={"decision": "decline"}, headers={"If-Match": "1"})
    assert r.status_code == 409


def test_messaging_ai_control_and_date_to_mutual_second_date(client, pair):
    a, b = pair
    conv = a.get("/conversations").json()["items"][0]
    conv_id = conv["id"]
    # Free-text send with retry safety
    cid = str(uuid.uuid4())
    r = a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": cid, "text": "Hi Ben, the matchmaker says we both like slow Saturdays."})
    assert r.status_code == 201
    r2 = a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": cid, "text": "Hi Ben, the matchmaker says we both like slow Saturdays."})
    assert r2.json()["id"] == r.json()["id"]
    assert len(a.get(f"/conversations/{conv_id}/messages").json()["items"]) == 1
    # AI draft is a draft: never sent by itself
    r = b.post(f"/conversations/{conv_id}/ai-drafts", json={"mode": "warm", "goal": "suggest_public_date"})
    assert r.status_code == 200, r.text
    draft = r.json()
    assert draft["can_auto_send"] is False and draft["requires_member_review"] is True
    assert len(a.get(f"/conversations/{conv_id}/messages").json()["items"]) == 1
    r = b.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": draft["text"] + " (edited)", "draft_id": draft["draft_id"]})
    assert r.status_code == 201 and r.json()["meta"]["draft_assisted"] is True
    # Translation preview
    r = a.post(f"/conversations/{conv_id}/translations", json={"text": "Would you like coffee Saturday?", "source_lang": "en", "target_lang": "it"})
    assert r.status_code == 200 and r.json()["can_auto_send"] is False and "sabato" in r.json()["translated"]["text"].lower()
    # Date planning
    r = a.post("/date-plans", json={"conversation_id": conv_id})
    assert r.status_code == 201, r.text
    plan = r.json()
    ov = a.get(f"/date-plans/{plan['id']}/overlaps").json()["items"]
    assert ov, "expected overlapping windows"
    venues = a.get(f"/date-plans/{plan['id']}/venues").json()["items"]
    assert len(venues) == 3 and all("lat" not in v for v in venues)
    r = a.post(f"/date-plans/{plan['id']}/proposals", json={"starts_at": ov[0]["starts_at"], "duration_minutes": 90, "venue_id": venues[0]["id"], "date_style": "coffee"}, headers={"If-Match": str(plan["version"])})
    assert r.status_code == 200 and r.json()["status"] == "proposed", r.text
    version = r.json()["version"]
    pb = b.get(f"/date-plans/{plan['id']}").json()
    assert pb["awaiting_your_confirmation"] is True
    r = b.post(f"/date-plans/{plan['id']}/respond", json={"action": "accept"}, headers={"If-Match": str(version)})
    assert r.status_code == 200 and r.json()["status"] == "confirmed", r.text
    # Check-in with scoped sharing
    r = a.post(f"/date-plans/{plan['id']}/check-in", json={"trusted_contact_name": "Giulia", "trusted_contact_channel": "+39 333 000 0000", "share_scope": "plan_and_checkin"})
    assert r.status_code == 200 and r.json()["check_in"]["state"] == "scheduled"
    # Feedback before the date starts is refused
    r = a.post(f"/date-plans/{plan['id']}/feedback", json={"attendance": "attended", "second_date_answer": "yes"})
    assert r.status_code == 409
    # Move the date into the past
    from app.core.db import session_factory
    from app.models.dates import DatePlan

    db = session_factory()()
    p = db.get(DatePlan, plan["id"])
    p.starts_at = utcnow() - timedelta(hours=3)
    p.ends_at = utcnow() - timedelta(hours=1)
    db.commit()
    db.close()
    r = a.post(f"/date-plans/{plan['id']}/feedback", json={"attendance": "attended", "felt_safe": True, "enjoyed": "yes", "second_date_answer": "yes"})
    assert r.status_code == 200 and r.json()["outcome"]["mutual"] is False
    # B has not answered: A sees no one-sided result
    assert a.get(f"/date-plans/{plan['id']}/mutual-outcome").json()["state"] == "no_mutual_result_yet"
    assert b.get(f"/date-plans/{plan['id']}/mutual-outcome").json()["state"] == "awaiting_your_feedback"
    r = b.post(f"/date-plans/{plan['id']}/feedback", json={"attendance": "attended", "felt_safe": True, "enjoyed": "yes", "second_date_answer": "yes"})
    assert r.json()["outcome"]["mutual"] is True
    assert a.get(f"/date-plans/{plan['id']}/mutual-outcome").json()["state"] == "mutual_second_date"
    concierge = staff(client, "concierge@example.test")
    m = concierge.get("/admin/marketplace").json()
    assert m["funnel"]["mutual_second_dates"] >= 1


def test_second_date_privacy_on_one_sided_no(client):
    a = Actor(client, unique_email("carla"))
    b = Actor(client, unique_email("dan"))
    onboard(a, gender="woman", seeking=["man"], name="Carla", zone="rome:monti")
    onboard(b, gender="man", seeking=["woman"], name="Dan", zone="rome:monti", birth_year=1988)
    subscribe(a)
    subscribe(b)
    run_batch(client)
    intro = find_intro_between(a, b.id)
    assert intro, "expected an introduction"
    a.post(f"/introductions/{intro['id']}/decision", json={"decision": "accept"})
    r = b.post(f"/introductions/{intro['id']}/decision", json={"decision": "accept"})
    conv_id = r.json()["conversation_id"]
    plan = a.post("/date-plans", json={"conversation_id": conv_id}).json()
    ov = a.get(f"/date-plans/{plan['id']}/overlaps").json()["items"]
    venues = a.get(f"/date-plans/{plan['id']}/venues").json()["items"]
    r = a.post(f"/date-plans/{plan['id']}/proposals", json={"starts_at": ov[0]["starts_at"], "venue_id": venues[0]["id"]})
    b.post(f"/date-plans/{plan['id']}/respond", json={"action": "accept"})
    from app.core.db import session_factory
    from app.models.dates import DatePlan

    db = session_factory()()
    p = db.get(DatePlan, plan["id"])
    p.starts_at = utcnow() - timedelta(hours=3)
    db.commit()
    db.close()
    a.post(f"/date-plans/{plan['id']}/feedback", json={"attendance": "attended", "second_date_answer": "yes"})
    b.post(f"/date-plans/{plan['id']}/feedback", json={"attendance": "attended", "second_date_answer": "no"})
    assert a.get(f"/date-plans/{plan['id']}/mutual-outcome").json()["state"] == "no_mutual_result_yet"
    assert b.get(f"/date-plans/{plan['id']}/mutual-outcome").json()["state"] == "no_mutual_result_yet"


def test_decline_privacy(client):
    a = Actor(client, unique_email("eva"))
    b = Actor(client, unique_email("finn"))
    onboard(a, gender="woman", seeking=["man"], name="Eva", zone="rome:trastevere")
    onboard(b, gender="man", seeking=["woman"], name="Finn", zone="rome:trastevere", birth_year=1991)
    subscribe(a)
    subscribe(b)
    run_batch(client)
    intro = find_intro_between(a, b.id)
    assert intro
    r = a.post(f"/introductions/{intro['id']}/decision", json={"decision": "decline", "reason_codes": ["timing"], "learning_consent": True})
    assert r.json()["status"] == "you_passed"
    seen = b.get(f"/introductions/{intro['id']}").json()
    assert seen["status"] == "unavailable" and seen["profile"] is None and seen["explanation"] is None
    # Nothing in the payload names a decline as the cause
    assert seen["your_decision"] is None and "declined" not in str(seen).lower()


def test_must_preference_integrity(client):
    a = Actor(client, unique_email("gia"))
    b = Actor(client, unique_email("hugo"))
    # Gia must have a partner who wants children; Hugo does not want children.
    onboard(a, gender="woman", seeking=["man"], name="Gia", zone="rome:eur", children="want", children_pref=["want", "open"], children_tier="must")
    onboard(b, gender="man", seeking=["woman"], name="Hugo", zone="rome:eur", birth_year=1989, children="no", children_pref=["no", "open"], children_tier="open")
    subscribe(a)
    subscribe(b)
    concierge, run = run_batch(client, publish=False)
    pairs = concierge.get(f"/admin/matching/runs/{run['id']}/pairs").json()["items"]
    assert not any({p["member_a"]["id"], p["member_b"]["id"]} == {a.id, b.id} for p in pairs)
    assert run["stats"]["gate_failures"].get("must:children", 0) >= 1
    # Impact preview shows the trade-off without saving
    r = a.post("/preferences/impact-preview", json={"key": "children", "tier": "open", "value": {"in": ["want", "open", "no"]}})
    assert r.status_code == 200 and r.json()["eligible_after"] >= r.json()["eligible_now"]
    assert next(p for p in a.get("/preferences").json()["preferences"] if p["key"] == "children")["tier"] == "must"


def test_ai_outage_keeps_manual_paths(client, pair):
    a, b = pair
    from app.ai import gateway

    gateway.set_provider_override(gateway.UnavailableProvider())
    try:
        conv_id = a.get("/conversations").json()["items"][0]["id"]
        r = a.post(f"/conversations/{conv_id}/ai-drafts", json={"mode": "natural", "goal": "respond"})
        assert r.status_code == 503 and r.json()["error"]["code"] == "AI_UNAVAILABLE"
        r = a.post(f"/conversations/{conv_id}/translations", json={"text": "ciao", "source_lang": "it", "target_lang": "en"})
        assert r.status_code == 503
        r = a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": "Manual message during outage"})
        assert r.status_code == 201
        assert a.get("/safety").status_code == 200
        assert a.get("/me/privacy").status_code == 200
        assert a.get("/account/review").status_code == 200
    finally:
        gateway.set_provider_override(None)


def test_global_block_and_report_and_appeal(client):
    a = Actor(client, unique_email("ines"))
    b = Actor(client, unique_email("jon"))
    onboard(a, gender="woman", seeking=["man"], name="Ines", zone="rome:parioli")
    onboard(b, gender="man", seeking=["woman"], name="Jon", zone="rome:parioli", birth_year=1987)
    subscribe(a)
    subscribe(b)
    run_batch(client)
    intro = find_intro_between(a, b.id)
    a.post(f"/introductions/{intro['id']}/decision", json={"decision": "accept"})
    conv_id = b.post(f"/introductions/{intro['id']}/decision", json={"decision": "accept"}).json()["conversation_id"]
    b.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": "Send me bitcoin and I'll tell you a secret"})
    # Report with immediate block
    r = a.post("/safety/reports", json={"subject_id": b.id, "category": "scam_or_fraud", "urgency": "recent", "narrative": "Asked me for crypto.", "conversation_id": conv_id, "block_now": True, "entry_surface": "conversation"}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    case = r.json()
    assert case["receipt_code"].startswith("SC-") and "contact_separated" in case["protection_applied"]
    # Blocked member cannot message and sees a neutral close
    r = b.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": "hello?"})
    assert r.status_code == 409
    summary = b.get(f"/conversations/{conv_id}").json()
    assert summary["status"] == "closed" and summary["other"]["display_name"] == "Member unavailable"
    # Blocked pair never re-enters candidate generation
    concierge, run = run_batch(client, publish=False)
    pairs = concierge.get(f"/admin/matching/runs/{run['id']}/pairs").json()["items"]
    assert not any({p["member_a"]["id"], p["member_b"]["id"]} == {a.id, b.id} for p in pairs)
    # Reviewer handles the case and applies a human decision
    reviewer = staff(client, "safety@example.test")
    detail = reviewer.get(f"/admin/safety/cases/{case['id']}", params={"purpose": "triage"}).json()
    assert detail["reporter"]["id"] == a.id and any("bitcoin" in c["text"] for c in detail["conversation_context"])
    r = reviewer.post(f"/admin/safety/cases/{case['id']}/actions", json={"type": "restrict", "reason_code": "scam_pattern", "public_notice": "Your account is restricted while we review a report of financial solicitation.", "duration_days": 30})
    assert r.status_code == 201
    # Subject gets a policy-level notice without reporter identity, and can appeal
    review = b.get("/account/review").json()
    assert review["status"] == "restricted" and review["actions"][0]["appealable"] is True
    assert a.id not in str(review) and "Ines" not in str(review)
    r = b.post(f"/account/review/{review['actions'][0]['id']}/appeal", json={"statement": "I was joking about crypto; I understand it read badly."})
    assert r.status_code == 201
    # The original reviewer cannot decide the appeal; an admin can
    appeal_id = r.json()["appeal_id"]
    r = reviewer.post(f"/admin/safety/appeals/{appeal_id}/decide", json={"outcome": "overturned", "rationale_code": "context"})
    assert r.status_code == 403
    admin = staff(client, "admin@example.test")
    r = admin.post(f"/admin/safety/appeals/{appeal_id}/decide", json={"outcome": "upheld", "rationale_code": "pattern_confirmed"})
    assert r.status_code == 200
    assert b.get("/account/review").json()["actions"][0]["appeal"]["outcome"] == "upheld"
    # Reporter can still see case status
    assert a.get(f"/safety/cases/{case['id']}").json()["status"] in ("actioned", "appealed")


def test_protected_credit_when_no_inventory(client):
    lonely = Actor(client, unique_email("lone"))
    onboard(lonely, gender="non_binary", seeking=["non_binary"], name="Lou", zone="rome:ostia")
    subscribe(lonely)
    run_batch(client)
    ent = lonely.get("/subscriptions/current").json()
    assert ent["entitlements"]["protected_credits"] >= 1
    waiting = lonely.get("/introductions/waiting").json()
    assert any(r["code"] == "no_qualified_inventory" for r in waiting["reasons"])
    # Ledger is append-only; a replayed batch never double-credits
    run_batch(client)
    assert lonely.get("/subscriptions/current").json()["entitlements"]["protected_credits"] == ent["entitlements"]["protected_credits"] + 1  # a new batch is a new week-run reference


def test_free_member_trial_then_paywall(client):
    a = Actor(client, unique_email("free"))
    b = Actor(client, unique_email("paid"))
    onboard(a, gender="man", seeking=["woman"], name="Free", zone="rome:ostia", birth_year=1993, distance=10)
    onboard(b, gender="woman", seeking=["man"], name="Paid", zone="rome:ostia", distance=10)
    subscribe(b)
    run_batch(client)
    intro = find_intro_between(a, b.id)
    assert intro and intro["is_trial"] is True
    assert a.get("/me").json()["capabilities"]["entitlements"]["trial_introductions_remaining"] == 0
    conv_less = a.post("/conversations/x/ai-drafts", json={})
    assert conv_less.status_code == 404
    # After the trial, new curated introductions require a plan (capacity is zero)
    from app.core.db import session_factory
    from app.models.account import Member
    from app.modules.matching.service import capacity_for

    db = session_factory()()
    assert capacity_for(db, db.get(Member, a.id)) == 0
    db.close()


def test_export_pause_and_deletion(client):
    m = Actor(client, unique_email("priv"))
    onboard(m, gender="woman", seeking=["woman"], name="Priya", zone="rome:pigneto")
    r = m.post("/me/export")
    assert r.status_code == 202
    data = m.get(r.json()["download_path"].removeprefix("/v1")).json()
    assert data["profile"]["display_name"] == "Priya" and data["blueprint_signals"]
    assert m.post("/me/pause").json()["status"] == "paused"
    assert m.get("/introductions").status_code == 200
    assert m.post("/me/resume").json()["status"] == "active"
    r = m.delete("/me")
    assert r.json()["status"] == "deletion_pending" and r.json()["deletion_due_at"]
    assert m.post("/me/cancel-deletion").json()["status"] == "active"
    m.delete("/me")
    from app.core.db import session_factory
    from app.jobs import retention_sweep
    from app.models.account import Member

    db = session_factory()()
    mem = db.get(Member, m.id)
    mem.deletion_due_at = utcnow() - timedelta(days=1)
    db.commit()
    stats = retention_sweep(db)
    db.commit()
    assert stats["deletions"] >= 1
    assert db.get(Member, m.id).status == "deleted"
    db.close()
    assert m.get("/me").status_code == 401


def test_analytics_allowlist_rejects_raw_text():
    from app.core.analytics import AnalyticsPropertyError, track

    with pytest.raises(AnalyticsPropertyError):
        track(None, "message_sent", "x", text="raw message")
    with pytest.raises(AnalyticsPropertyError):
        track(None, "not_an_event", "x")


def test_webhook_forgery_rejected(client):
    r = client.post("/v1/webhooks/verification", content=b"{}", headers={"X-Vendor-Timestamp": "1", "X-Vendor-Signature": "bad"})
    assert r.status_code == 403
    r = client.post("/v1/webhooks/payments", content=b"{}", headers={"X-Vendor-Timestamp": "1", "X-Vendor-Signature": "bad"})
    assert r.status_code == 403
