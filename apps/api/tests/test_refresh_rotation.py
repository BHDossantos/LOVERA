"""Refresh tokens are single-use, and that is the property worth protecting.

`rotate_session` revokes the token it was given and issues the next one. A copy of a spent token is
then worthless, and a thief who uses one is detected the moment the real client's next refresh fails.

It has a cost, which these tests also pin so nobody "fixes" it by accident: the server commits the
rotation before the client can store the result, so a full page load or an app restart during that
one round trip leaves the client holding a dead token and `apps/web/src/lib/api.ts` signs them out.

I tried to soften that with a sixty-second grace window and reverted it, because review showed the
cure was worse: handing a replayed token the live session lets whoever holds a copy take the session
over and leaves the real client with the revoked half. The remedies that do work need a security
decision rather than a patch, and are recorded in docs/LAUNCH-READINESS.md. Until then the behaviour
asserted here is the behaviour we want.
"""
from __future__ import annotations

from tests.conftest import Actor, unique_email


def _signed_in(client) -> tuple[Actor, str]:
    a = Actor(client, unique_email("rotate"))
    a.sign_in()
    assert a.refresh, "sign-in has to hand back a refresh token"
    return a, a.refresh


def test_a_refresh_token_works_once_and_hands_over_a_working_session(client):
    a, first = _signed_in(client)

    r = client.post("/v1/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 200, r.text
    second = r.json()["refresh_token"]
    assert second != first, "rotation has to issue a new token, not re-serve the old one"

    # What came back actually works, for the API and for the next rotation.
    a.token = r.json()["access_token"]
    assert a.get("/me").status_code == 200
    assert client.post("/v1/auth/refresh", json={"refresh_token": second}).status_code == 200


def test_a_spent_token_is_refused(client):
    """The security property, stated as a test so it cannot be traded away quietly.

    A thief holding a copy of a token the real client has already spent gets nothing, and the real
    client's own next refresh is what reveals a theft in the other order.
    """
    a, first = _signed_in(client)
    assert client.post("/v1/auth/refresh", json={"refresh_token": first}).status_code == 200
    assert client.post("/v1/auth/refresh", json={"refresh_token": first}).status_code == 401


def test_signing_out_ends_the_session(client):
    a, first = _signed_in(client)
    assert a.post("/auth/logout").status_code == 204
    assert client.post("/v1/auth/refresh", json={"refresh_token": first}).status_code == 401


def test_a_token_that_was_never_issued_is_refused(client):
    assert client.post("/v1/auth/refresh", json={"refresh_token": "not-a-token"}).status_code == 401
