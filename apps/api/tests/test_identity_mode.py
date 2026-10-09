"""Whether a production API can be started that nobody can finish signing up to.

Onboarding hard-gates on a verification result (`account.service.advance_onboarding`), and the
sandbox provider's completion endpoint is correctly refused in production. So the default
`MM_IDENTITY_PROVIDER=sandbox`, deployed to production, is a dead end for every member: they sign
up, reach step 2 of 6, and stop. Every endpoint answers and every health check is green while
nobody can get in — the same shape as a deploy with no mail host, which this API already refuses
to start for.

The escape hatch existed but was not a declared posture: `POST /verification/review-request` puts
somebody in a staff queue, and it refused to do even that unless there was already a failed attempt
to attach the request to. `manual_review` makes "a person approves every member" a mode somebody
chooses, with the app saying so.
"""
from __future__ import annotations

import pytest

from app.core.config import Settings, get_settings
from app.main import check_identity_provider
from tests.conftest import Actor, staff, unique_email


def settings_for(monkeypatch, **values):
    """The guard reads cached settings, so the cache is what has to change."""
    s = Settings(**values)
    monkeypatch.setattr(get_settings, "__wrapped__", lambda: s, raising=False)
    monkeypatch.setattr("app.main.get_settings", lambda: s)
    return s


def test_production_with_the_sandbox_vendor_refuses_to_start(monkeypatch):
    """The dead end, refused at boot rather than discovered by the first member."""
    settings_for(monkeypatch, env="production", identity_provider="sandbox")
    with pytest.raises(RuntimeError) as e:
        check_identity_provider()
    message = str(e.value)
    assert "every signup would stop at the verification step" in message
    # And it has to name both ways out, or it is just a complaint.
    assert "manual_review" in message and "identity vendor" in message


def test_production_with_manual_review_or_a_real_vendor_starts(monkeypatch):
    for provider in ("manual_review", "some-real-vendor"):
        settings_for(monkeypatch, env="production", identity_provider=provider)
        check_identity_provider()  # must not raise


def test_the_sandbox_is_still_fine_outside_production(monkeypatch):
    """It is the right default for a laptop, and the whole test suite depends on it."""
    settings_for(monkeypatch, env="staging", identity_provider="sandbox")
    check_identity_provider()


def test_manual_review_sends_nobody_to_a_vendor_page_that_cannot_finish(client, monkeypatch):
    """With no vendor there is no hosted flow, so the API must not pretend there is one.

    Handing back a `hosted_url` is the dishonest version: the member opens a capture page that
    cannot complete and waits at step 2 of 6 indefinitely.
    """
    monkeypatch.setattr("app.modules.verification.service.get_settings", lambda: Settings(env="test", identity_provider="manual_review"))
    a = Actor(client, unique_email("manual"))
    a.sign_in()
    assert a.post("/me/adult-consent", json={"birth_date": "1990-05-05", "accept_terms": True, "accept_privacy": True, "accept_community": True, "ai_processing_consent": True}).status_code == 200

    r = a.post("/verification/sessions")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["session"] is None, "there is no vendor session to hand back"
    assert body["mode"] == "manual_review"
    assert body["status"] == "review_required", "the member is in the queue, not waiting on a page"
    assert "person" in body["alternate_path"], body["alternate_path"]


def test_a_member_can_ask_for_a_human_review_with_nothing_to_attach_it_to(client):
    """It used to refuse for want of a failed attempt, which made the endpoint's name a lie.

    Asking a person to check you is a reasonable first move — and in `manual_review` mode it is the
    only move.
    """
    a = Actor(client, unique_email("review-first"))
    a.sign_in()
    assert a.post("/me/adult-consent", json={"birth_date": "1988-03-03", "accept_terms": True, "accept_privacy": True, "accept_community": True, "ai_processing_consent": True}).status_code == 200

    r = a.post("/verification/review-request", json={"note": "I would rather a person did this"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "review_required"


def test_an_already_verified_member_is_told_so_rather_than_re_queued(client):
    a = Actor(client, unique_email("already"))
    a.sign_in()
    assert a.post("/me/adult-consent", json={"birth_date": "1991-07-07", "accept_terms": True, "accept_privacy": True, "accept_community": True, "ai_processing_consent": True}).status_code == 200
    ref = a.post("/verification/sessions").json()["session"]["provider_ref"]
    assert a.post("/verification/sandbox/complete", json={"provider_ref": ref}).json()["status"] == "verified"

    r = a.post("/verification/review-request", json={})
    assert r.status_code == 409, r.text
    assert "already verified" in r.json()["error"]["message"].lower()


def test_a_queued_member_is_approved_from_the_admin_queue(client):
    """The path `manual_review` relies on, end to end: queue, approve, onboarding moves on.

    This one passes against the unfixed code too, and is here deliberately: the queue and the
    approval already worked, and the whole case for `manual_review` as a posture is that they do.
    It is a regression test for somebody else's code, not evidence for mine.
    """
    a = Actor(client, unique_email("queued"))
    a.sign_in()
    assert a.post("/me/adult-consent", json={"birth_date": "1992-02-02", "accept_terms": True, "accept_privacy": True, "accept_community": True, "ai_processing_consent": True}).status_code == 200
    a.post("/verification/sessions")
    assert a.post("/verification/review-request", json={"note": "please review"}).json()["status"] == "review_required"

    reviewer = staff(client, "safety@example.test")
    queue = reviewer.get("/admin/verification/queue")
    assert queue.status_code == 200, queue.text
    mine = [row for row in queue.json()["items"] if row["status"] == "review_required"]
    assert mine, "a queued member has to be visible to the person who approves them"

    target = next(row for row in mine if row["review_note"] == "please review")
    r = reviewer.post(f"/admin/verification/{target['id']}/review", json={"decision": "approve"})
    assert r.status_code == 200, r.text
    assert a.get("/verification/status").json()["status"] == "verified"
    assert a.get("/me").json()["onboarding_step"] != "verification", "and onboarding is no longer stuck"
