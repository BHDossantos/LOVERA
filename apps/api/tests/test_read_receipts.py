"""Marking a conversation read has to work the first time, and every time after.

`mark_read` creates the cursor row when there is none and then did
`max(cursor.last_read_sequence, sequence)`. `default=0` on that column is a *column* default, applied
by the INSERT — so on a row that has only been added to the session the Python attribute is still
None, and `max(None, 3)` raises. The 500 rolled the transaction back, so the row was never written,
so the next call added a fresh one and raised again.

That made it permanent rather than a first-time glitch: `read_cursors` stayed empty, `unread_count`
fell back to "nothing has been read", and every message a member had already read went on being
counted as unread in both apps, for ever. Found in an API log while chasing something else, which is
the only reason it was found at all — both clients fire this and ignore the result, so nothing
visible fails except a badge that never clears.
"""
from __future__ import annotations

import uuid

from tests.conftest import mutual_pair


def _unread_for(actor, conv_id: str) -> int:
    items = actor.get("/conversations").json()["items"]
    conv = next((c for c in items if c["id"] == conv_id), None)
    assert conv, "the conversation has to be listed for its unread count to mean anything"
    return conv["unread"]


def test_reading_a_conversation_clears_its_unread_count(client):
    a, b, conv_id = mutual_pair(client, "read")

    r = a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": "Hello Bo, how are your Saturdays?"})
    assert r.status_code == 201, r.text
    sequence = r.json()["sequence"]
    assert _unread_for(b, conv_id) == 1

    # The first call is the one that used to 500, because it is the one that creates the cursor.
    assert b.post(f"/conversations/{conv_id}/read", json={"sequence": sequence}).status_code == 204
    assert _unread_for(b, conv_id) == 0

    # And it stays read: the row now exists, so this takes the other path through the same function.
    assert b.post(f"/conversations/{conv_id}/read", json={"sequence": sequence}).status_code == 204
    assert _unread_for(b, conv_id) == 0


def test_reading_backwards_does_not_unread_what_was_read(client):
    """`max` is the point of the line: a client reporting an older sequence must not rewind it."""
    a, b, conv_id = mutual_pair(client, "rewind")
    first = a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": "One."}).json()["sequence"]
    second = a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": "Two."}).json()["sequence"]
    assert second > first

    assert b.post(f"/conversations/{conv_id}/read", json={"sequence": second}).status_code == 204
    assert _unread_for(b, conv_id) == 0
    assert b.post(f"/conversations/{conv_id}/read", json={"sequence": first}).status_code == 204
    assert _unread_for(b, conv_id) == 0, "a late in-flight read of an older message must not resurrect it"


def test_the_sender_has_nothing_to_read_of_their_own(client):
    a, b, conv_id = mutual_pair(client, "own")
    a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": "Mine."})
    assert _unread_for(a, conv_id) == 0
