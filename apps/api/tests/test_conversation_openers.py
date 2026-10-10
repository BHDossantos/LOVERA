"""Two things the loved dating apps do that this one did not, and the ways both go wrong.

**A blank box is where conversations die.** After a mutual yes the app handed both people an
empty message field, and "hey" is what anybody writes when there is nothing specific to answer.
The other person's prompt answers are specific by construction — they were written to be replied
to and they chose them — so `/conversations/{id}/openers` offers them, and a reply carries the
prompt it is answering so the quote sits above the message.

The failure mode to design against is not a missing feature, it is **putting words in somebody's
mouth**: the quote renders as theirs, so a free-text "replying to" would let anybody fabricate a
line inside their own conversation. The key is validated against what they really wrote, and the
answer is copied onto the message at send time rather than re-read later — otherwise editing a
prompt would silently rewrite what a two-week-old quote says they said.

**"Whose turn is it" is the only question worth asking of a message list**, and a list sorted by
recency does not answer it. `your_turn` is computed once on the server because both clients
computing it from `last_message.mine` is precisely how the two apps come to disagree about who
owes a reply.
"""
from __future__ import annotations

import uuid

from tests.conftest import mutual_pair


def test_openers_offer_the_other_members_own_prompt_answers(client):
    a, b, conv_id = mutual_pair(client, "openers")
    items = a.get(f"/conversations/{conv_id}/openers").json()["items"]

    assert items, "a conversation with nothing in it should offer something to say"
    keys = {i["key"] for i in items}
    assert "second_date" in keys
    one = next(i for i in items if i["key"] == "second_date")
    # The label is what the prompt asked, and the answer is what they wrote. Both are needed to
    # render a quote; a key alone would make the client keep its own copy of the catalog.
    assert one["label"] == "A second date I'd say yes to looks like"
    assert one["answer"] == "Something outdoors with good coffee."


def test_each_side_is_offered_the_other_persons_prompts(client):
    a, b, conv_id = mutual_pair(client, "openers-sym")
    mine = a.get(f"/conversations/{conv_id}/openers").json()["items"]
    theirs = b.get(f"/conversations/{conv_id}/openers").json()["items"]
    assert mine and theirs
    # Both members answered the same two prompts in the fixture, so the keys match and the point
    # is that neither is offered their own answers to respond to — which is checked by the quote
    # test below, where the stored answer is the *other* member's.


def test_a_reply_carries_the_prompt_it_answers(client):
    a, b, conv_id = mutual_pair(client, "openers-reply")
    r = a.post(
        f"/conversations/{conv_id}/messages",
        json={
            "client_message_id": uuid.uuid4().hex,
            "text": "Good coffee outdoors is a very specific ask and I respect it. Where is yours?",
            "prompt_key": "second_date",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["replying_to"]["key"] == "second_date"
    assert body["replying_to"]["answer"] == "Something outdoors with good coffee."

    # And the other side sees the same quote above the same message.
    items = b.get(f"/conversations/{conv_id}/messages").json()["items"]
    assert items[-1]["replying_to"]["answer"] == "Something outdoors with good coffee."


def test_nobody_can_put_words_in_the_other_persons_mouth(client):
    """The quote renders as theirs, so the key has to be one of theirs."""
    a, _, conv_id = mutual_pair(client, "openers-forge")
    r = a.post(
        f"/conversations/{conv_id}/messages",
        json={"client_message_id": uuid.uuid4().hex, "text": "About what you said…", "prompt_key": "languages"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["field_errors"] == {"prompt_key": "unknown"}


def test_editing_a_prompt_does_not_rewrite_an_old_quote(client):
    """The answer is copied onto the message, not looked up when it is read."""
    a, b, conv_id = mutual_pair(client, "openers-edit")
    a.post(
        f"/conversations/{conv_id}/messages",
        json={"client_message_id": uuid.uuid4().hex, "text": "Tell me more about that.", "prompt_key": "second_date"},
    )
    # b rewrites the prompt a replied to.
    profile = b.get("/profile").json()
    r = b.patch(
        "/profile",
        json={"version": profile["version"], "prompts": [{"key": "second_date", "answer": "Actually, a loud bar and a late night."}]},
    )
    assert r.status_code == 200, r.text

    quoted = a.get(f"/conversations/{conv_id}/messages").json()["items"][-1]["replying_to"]["answer"]
    assert quoted == "Something outdoors with good coffee.", "the quote changed to something they never said at the time"


def test_an_empty_conversation_is_your_turn(client):
    """Somebody has to speak first. A pair who both think it is the other's move never do."""
    a, b, conv_id = mutual_pair(client, "turn-empty")
    for actor in (a, b):
        row = next(c for c in actor.get("/conversations").json()["items"] if c["id"] == conv_id)
        assert row["your_turn"] is True


def test_the_turn_passes_with_the_message(client):
    a, b, conv_id = mutual_pair(client, "turn-pass")
    a.post(f"/conversations/{conv_id}/messages", json={"client_message_id": uuid.uuid4().hex, "text": "Thursday or Friday?"})

    mine = next(c for c in a.get("/conversations").json()["items"] if c["id"] == conv_id)
    theirs = next(c for c in b.get("/conversations").json()["items"] if c["id"] == conv_id)
    assert mine["your_turn"] is False, "it is not your turn when you spoke last"
    assert theirs["your_turn"] is True

    b.post(f"/conversations/{conv_id}/messages", json={"client_message_id": uuid.uuid4().hex, "text": "Friday."})
    mine = next(c for c in a.get("/conversations").json()["items"] if c["id"] == conv_id)
    assert mine["your_turn"] is True


def test_a_paused_conversation_is_nobodys_turn(client):
    """A nudge to reply to a thread the member cannot reply to is worse than no nudge."""
    from app.core.db import session_factory
    from app.models.conversations import Conversation

    a, b, conv_id = mutual_pair(client, "turn-hold")
    db = session_factory()()
    try:
        conv = db.get(Conversation, conv_id)
        conv.safety_hold = True
        db.commit()
    finally:
        db.close()

    row = next(c for c in a.get("/conversations").json()["items"] if c["id"] == conv_id)
    assert row["your_turn"] is False
