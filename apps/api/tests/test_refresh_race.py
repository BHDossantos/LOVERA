"""A refresh whose response never arrived must not sign the member out.

`rotate_session` revokes the token it was given and issues the next one, which is what makes a
copied token worthless after the member's own client has refreshed once. It also means the server
commits the rotation before the client can store the result: a navigation or a reload in that window
leaves the client holding a token the server has already revoked, and `apps/web/src/lib/api.ts`
treats a failed refresh as "signed out", because the alternative is a loop. So tapping a link at the
wrong moment signed somebody out and sent them back for a new code.

These tests fix both halves of the intended behaviour: the interrupted client recovers, and
everything that is not an interrupted client still fails.
"""
from __future__ import annotations

from tests.conftest import Actor, unique_email


def _signed_in(client) -> tuple[Actor, str]:
    a = Actor(client, unique_email("race"))
    a.sign_in()
    assert a.refresh, "sign-in has to hand back a refresh token"
    return a, a.refresh


def test_a_refresh_whose_response_was_lost_still_works(client):
    a, first = _signed_in(client)

    # The rotation the client never received.
    r = client.post("/v1/auth/refresh", json={"refresh_token": first})
    assert r.status_code == 200, r.text
    second = r.json()["refresh_token"]

    # The client retries with what it still has, because the reply never reached it.
    again = client.post("/v1/auth/refresh", json={"refresh_token": first})
    assert again.status_code == 200, "an interrupted refresh must not sign the member out"
    third = again.json()["refresh_token"]
    assert third not in (first, second), "the replay has to hand back a new token, not re-serve a dead one"

    # And what it got back actually works: the point is a member who stays signed in.
    a.token = again.json()["access_token"]
    assert a.get("/me").status_code == 200
    assert client.post("/v1/auth/refresh", json={"refresh_token": third}).status_code == 200


def test_the_grace_does_not_outlive_the_chain_it_belongs_to(client):
    a, first = _signed_in(client)
    second = client.post("/v1/auth/refresh", json={"refresh_token": first}).json()["refresh_token"]
    # The real client carried on and refreshed again, so `first` is two links back now. A token
    # presented at that point is not an interrupted response; it is a copy of something superseded.
    assert client.post("/v1/auth/refresh", json={"refresh_token": second}).status_code == 200
    assert client.post("/v1/auth/refresh", json={"refresh_token": first}).status_code == 401


def test_signing_out_still_means_signed_out(client):
    a, first = _signed_in(client)
    assert a.post("/auth/logout").status_code == 204
    # No rotation row exists for a session revoked by logout, so there is nothing to fall back to.
    assert client.post("/v1/auth/refresh", json={"refresh_token": first}).status_code == 401


def test_a_token_that_was_never_issued_is_refused(client):
    assert client.post("/v1/auth/refresh", json={"refresh_token": "not-a-token"}).status_code == 401
