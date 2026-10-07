"""Safety actions that have to survive a conversation ending.

In its own file rather than appended to test_journey.py: two branches appending a test to the
end of that one file collided on every rebase, and one of those resolutions spliced two tests
together into a function that referenced a name it never imported.
"""
from __future__ import annotations

import uuid

from tests.conftest import Actor, onboard, subscribe, unique_email
from tests.test_journey import find_intro_between, run_batch


def test_an_ended_conversation_still_carries_a_safety_target(client):
    """Reporting somebody usually happens after the thing is over, not during it.

    `summary()` neutralises the other member once a conversation closes — no name, no photo,
    no id — which is the right privacy call. But the clients read the block and report target
    off that same snapshot, so an ended thread could do neither: a report with no subject
    reaches a reviewer who cannot act on anybody. The target is carried separately now.
    """
    # Its own pair: the module's shared one has been through several tests by here, and this
    # needs a conversation it is free to close.
    a = Actor(client, unique_email("ana-ended"))
    b = Actor(client, unique_email("ben-ended"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", zone="rome:prati")
    onboard(b, gender="man", seeking=["woman"], name="Ben", zone="rome:centro", birth_year=1990)
    subscribe(a)
    subscribe(b)
    run_batch(client, publish=True)
    intro = find_intro_between(a, b.id)
    assert intro, "the batch did not introduce the two members this test created"
    for actor in (a, b):
        actor.post(f"/introductions/{intro['id']}/decision", json={"decision": "accept"}, headers={"Idempotency-Key": str(uuid.uuid4())})
    conv = a.get("/conversations").json()["items"][0]
    assert conv["safety"]["subject_id"] == b.id and conv["safety"]["blocked_by_you"] is False

    a.post(f"/conversations/{conv['id']}/close", json={"reason": "not_for_me", "block": False})
    ended = a.get(f"/conversations/{conv['id']}").json()
    assert ended["status"] == "closed"
    # The profile is gone, as it should be.
    assert ended["other"]["member_id"] is None and ended["other"]["display_name"] == "Member unavailable"
    # The safety target is not.
    assert ended["safety"]["subject_id"] == b.id and ended["safety"]["blocked_by_you"] is False

    # And it is still actionable: blocking from an ended conversation works.
    r = a.post("/blocks", json={"member_id": ended["safety"]["subject_id"]})
    assert r.status_code == 201 and r.json()["applied"] is True
    assert a.get(f"/conversations/{conv['id']}").json()["safety"]["blocked_by_you"] is True
    # The other side is told nothing about who blocked them.
    assert b.get(f"/conversations/{conv['id']}").json()["safety"]["blocked_by_you"] is False
