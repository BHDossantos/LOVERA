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

import threading
import uuid

from sqlalchemy import select

from app.core.db import session_factory
from app.models.conversations import Conversation, ReadCursor
from app.modules.conversations.service import mark_read
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


def _stored_sequence(conv_id: str, member_id: str) -> int | None:
    with session_factory()() as db:
        cursor = db.execute(select(ReadCursor).where(ReadCursor.conversation_id == conv_id, ReadCursor.member_id == member_id)).scalar_one_or_none()
        return cursor.last_read_sequence if cursor else None


def test_two_overlapping_reads_cannot_lose_the_higher_one(client):
    """The `max` has to happen in the database, not in Python.

    Two tabs, or a newer message arriving before the previous POST finishes, means two transactions
    overlapping on the same row. Reading the cursor and computing the new value in this process means
    both read the same number and the one that commits last wins — so an older sequence can overwrite a
    newer one and put messages the member has read back to unread. Nothing about a single request shows
    it, which is why it needs this shape of test: the second transaction starts before the first
    commits, and commits after it.

    The upsert makes the comparison the database's: `ON CONFLICT ... GREATEST` locks the row, so the
    second statement blocks until the first commits and is then evaluated against what it wrote.
    """
    a, b, conv_id = mutual_pair(client, "race")
    # Three sequences, so the two racing reads are both *above* what is already stored. A second read
    # equal to the stored value writes nothing — SQLAlchemy emits no change for an unchanged column —
    # and this test passed against the broken code until it had three to work with.
    sequences = [
        a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": str(uuid.uuid4()), "text": text}).json()["sequence"]
        for text in ("One.", "Two.", "Three.")
    ]
    stored, lower, high = sequences
    assert stored < lower < high

    # The row exists first, which is the interleaving that loses data: both transactions would read it.
    assert b.post(f"/conversations/{conv_id}/read", json={"sequence": stored}).status_code == 204

    started = threading.Event()
    finished = threading.Event()
    failure: list[BaseException] = []

    ahead = session_factory()()
    behind = session_factory()()
    try:
        conv_ahead = ahead.execute(select(Conversation).where(Conversation.id == conv_id)).scalar_one()
        mark_read(ahead, conv_ahead, b.id, high)
        ahead.flush()  # the row is now locked by this uncommitted transaction

        def older_read() -> None:
            try:
                conv_behind = behind.execute(select(Conversation).where(Conversation.id == conv_id)).scalar_one()
                started.set()
                mark_read(behind, conv_behind, b.id, lower)  # blocks on the lock above
                behind.commit()
            except BaseException as exc:  # pragma: no cover - reported below
                failure.append(exc)
            finally:
                finished.set()

        thread = threading.Thread(target=older_read, daemon=True)
        thread.start()
        assert started.wait(10), "the second transaction never got going"
        # It must still be waiting: if it had finished already it never saw the first one's row.
        assert not finished.wait(1), "the older read did not block on the newer one's lock"

        ahead.commit()
        thread.join(timeout=20)
        assert not failure, f"the older read failed: {failure[0]!r}"
        assert finished.is_set(), "the older read never completed after the lock was released"
    finally:
        ahead.close()
        behind.close()

    assert _stored_sequence(conv_id, b.id) == high, "the older read overwrote the newer one"
    assert _unread_for(b, conv_id) == 0


def test_a_cursor_cannot_be_advanced_past_the_last_message(client):
    """A sequence from beyond the end of the conversation is clamped to its head.

    Nothing stopped a client sending one, and `GREATEST` made it permanent: `unread_count` counts
    messages *above* the cursor, so a cursor past the end marks every real message read and every
    future one too, until the conversation catches up with whatever number arrived. A client bug
    would be enough to do it, and the member has no way back — the unread badge simply never
    returns.
    """
    from app.modules.conversations.service import unread_count

    a, b, conv_id = mutual_pair(client, "clamp")
    for i in range(3):
        r = b.post(f"/conversations/{conv_id}/messages", json={"client_message_id": f"m{i}-{uuid.uuid4().hex[:6]}", "text": f"Message {i}", "type": "text"})
        assert r.status_code == 201, r.text

    r = a.post(f"/conversations/{conv_id}/read", json={"sequence": 10**9})
    assert r.status_code == 204, r.text

    with session_factory()() as db:
        conv = db.execute(select(Conversation).where(Conversation.id == conv_id)).scalar_one()
        cursor = db.execute(select(ReadCursor).where(ReadCursor.conversation_id == conv_id, ReadCursor.member_id == a.id)).scalar_one()
        assert cursor.last_read_sequence == conv.message_seq, f"cursor {cursor.last_read_sequence} past head {conv.message_seq}"
        # And the member still sees what arrives next, which is the half that actually hurt.
        assert unread_count(db, conv, a.id) == 0
    r = b.post(f"/conversations/{conv_id}/messages", json={"client_message_id": f"after-{uuid.uuid4().hex[:6]}", "text": "And one more", "type": "text"})
    assert r.status_code == 201, r.text
    with session_factory()() as db:
        conv = db.execute(select(Conversation).where(Conversation.id == conv_id)).scalar_one()
        assert unread_count(db, conv, a.id) == 1, "a message sent after the bad cursor has to count as unread"
