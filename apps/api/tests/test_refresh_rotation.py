"""Refresh rotation: a retry must survive, and a replay must not.

Rotation was strictly single-use. That protects the right thing and cost members their session for
no reason: the server retired the presented token before the client could store its replacement, so a
full page load or an app cold start inside that one round trip left the client holding a dead token,
and `apps/web/src/lib/api.ts` reads a failed refresh as signed out.

Softening it by answering a replayed token *from its replacement* was tried and reverted — that hands
whoever holds a copy the live session and leaves the real client with the revoked half.

What is here instead defers the retirement. The presented token is superseded, not revoked, and stays
usable until its replacement's own token is used or a short grace period expires. A retry inside that
window mints a *fresh* replacement rather than re-serving one, so nothing is ever handed to two
parties. Outside it, a token coming back is a replay, and every session descended from that sign-in is
revoked at once (OAuth 2.0 Security BCP §4.13.2). The device the session was issued to is what tells
the two apart while the window is open.
"""
from __future__ import annotations

from datetime import timedelta

from tests.conftest import Actor, unique_email

DEVICE = "test-device"  # what conftest's sign_in registers


def _signed_in(client) -> tuple[Actor, str]:
    a = Actor(client, unique_email("rotate"))
    a.sign_in()
    assert a.refresh, "sign-in has to hand back a refresh token"
    return a, a.refresh


def _refresh(client, token: str, device: str | None = DEVICE):
    body: dict[str, object] = {"refresh_token": token}
    if device is not None:
        body["device_id"] = device
    return client.post("/v1/auth/refresh", json=body)


def test_a_refresh_token_hands_over_a_working_session(client):
    a, first = _signed_in(client)

    r = _refresh(client, first)
    assert r.status_code == 200, r.text
    second = r.json()["refresh_token"]
    assert second != first, "rotation has to issue a new token, not re-serve the old one"

    # What came back actually works, for the API and for the next rotation.
    a.token = r.json()["access_token"]
    assert a.get("/me").status_code == 200
    assert _refresh(client, second).status_code == 200


def test_a_refresh_whose_reply_never_arrived_can_be_retried(client):
    """The bug this is all for. Confirmed failing against single-use rotation with 401.

    The client sends its token, the server rotates, and the reply is lost — a reload, a cold start, a
    dropped connection. The client still holds the only token it ever stored, and retrying with it has
    to work, because the alternative is signing somebody out for being on a train.
    """
    a, first = _signed_in(client)

    lost = _refresh(client, first)
    assert lost.status_code == 200
    # ... and that reply is dropped on the floor: the client never stores or uses it.

    retry = _refresh(client, first)
    assert retry.status_code == 200, retry.text
    issued = retry.json()["refresh_token"]
    assert issued != lost.json()["refresh_token"], "a retry mints a fresh token; re-serving one is what lets two parties hold it"

    a.token = retry.json()["access_token"]
    assert a.get("/me").status_code == 200, "and the session it hands back is a working one"
    # The replacement nobody received is no good to anybody now.
    assert _refresh(client, lost.json()["refresh_token"]).status_code == 401


def test_the_overlap_closes_as_soon_as_the_replacement_is_used(client):
    """Using the new token is the client proving it stored it, and that retires the old one at once.

    So the window is a round trip in the ordinary case, not the whole grace period.
    """
    a, first = _signed_in(client)
    r = _refresh(client, first)
    assert r.status_code == 200
    second = r.json()["refresh_token"]

    a.token = r.json()["access_token"]
    assert a.get("/me").status_code == 200, "the client uses what it was given"

    assert _refresh(client, first).status_code == 401, "the superseded token is spent the moment its replacement is live"


def test_a_replayed_token_takes_the_whole_chain_down(client):
    """Two parties hold this token, and there is no way to tell which one is the member.

    The BCP answer is to end the sign-in: both are signed out and the member re-authenticates with a
    one-time code. Leaving the newer session alive would mean a thief who replays an old token simply
    confirms the real client's session for them.
    """
    a, first = _signed_in(client)
    r = _refresh(client, first)
    second = r.json()["refresh_token"]
    a.token = r.json()["access_token"]
    assert a.get("/me").status_code == 200

    assert _refresh(client, first).status_code == 401, "the replay itself"
    assert _refresh(client, second).status_code == 401, "and the session it was replayed against"
    assert a.get("/me").status_code == 401, "including the access token already in the client's hands"


def test_a_spent_token_from_another_device_is_a_replay_even_inside_the_window(client):
    """What stops the overlap being a takeover window.

    Between a rotation and the client using its replacement, the superseded token still works — and
    the case that window exists for is precisely the one where the real client is absent. The session
    carries the hash of the device it was issued to, which is not carried inside the token, so a token
    that leaks on its own does not bring it along.
    """
    a, first = _signed_in(client)
    assert _refresh(client, first).status_code == 200, "rotated, and the reply is 'lost'"

    stolen = _refresh(client, first, device="somebody-elses-laptop")
    assert stolen.status_code == 401, "no retry is plausible from a device this session was never issued to"
    # And it is read as the theft it is, not as a near miss: the chain is gone.
    assert _refresh(client, first, device=DEVICE).status_code == 401


def test_the_overlap_does_not_outlive_its_grace_period(client, monkeypatch):
    """A client that never comes back must not leave a usable token lying around indefinitely."""
    a, first = _signed_in(client)
    assert _refresh(client, first).status_code == 200

    monkeypatch.setattr("app.core.sessions.SUPERSEDED_GRACE", timedelta(seconds=-1))
    assert _refresh(client, first).status_code == 401


def test_signing_out_ends_the_whole_chain(client):
    """Revoking only the current link would leave the one it was rotated from alive in its grace
    period — and that is a token a client may still be holding, so "sign me out" would not have."""
    a, first = _signed_in(client)
    r = _refresh(client, first)
    second = r.json()["refresh_token"]
    a.token = r.json()["access_token"]

    assert a.post("/auth/logout").status_code == 204
    assert _refresh(client, second).status_code == 401
    assert _refresh(client, first).status_code == 401


def test_a_token_that_was_never_issued_is_refused(client):
    assert _refresh(client, "not-a-token").status_code == 401
