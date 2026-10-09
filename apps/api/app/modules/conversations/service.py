from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func, or_, select
# Postgres-specific, deliberately: `ON CONFLICT ... GREATEST` is what makes the read cursor's advance
# atomic, and this application has only ever run on Postgres (JSONB columns, advisory locks).
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.audit import audit
from app.core.errors import ApiError
from app.core.ids import new_id
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.conversations import Conversation, Message, ReadCursor
from app.models.dates import DatePlan
from app.modules.conversations.realtime import hub
from app.modules.notifications.service import notify
from app.modules.profile.service import snapshot_for_viewer

SCAM_PATTERNS = re.compile(r"\b(crypto|bitcoin|investment|wire transfer|western union|gift card|send money|urgent(ly)? need|my account is blocked|whatsapp|telegram)\b", re.IGNORECASE)
ABUSE_PATTERNS = re.compile(r"\b(kill you|hurt you|slut|whore|bitch|find where you live)\b", re.IGNORECASE)
MAX_MESSAGES_PER_HOUR = 60


def get_conversation(db: Session, conversation_id: str, member_id: str) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None or not conv.has_participant(member_id):
        raise ApiError("NOT_FOUND")
    return conv


def unread_count(db: Session, conv: Conversation, member_id: str) -> int:
    cursor = db.execute(select(ReadCursor).where(ReadCursor.conversation_id == conv.id, ReadCursor.member_id == member_id)).scalar_one_or_none()
    last_read = cursor.last_read_sequence if cursor else 0
    from sqlalchemy import func

    return db.execute(select(func.count(Message.id)).where(Message.conversation_id == conv.id, Message.sequence > last_read, Message.sender_id != member_id, Message.deleted_at.is_(None))).scalar() or 0


def date_status(db: Session, conv: Conversation) -> dict[str, Any] | None:
    plan = db.execute(select(DatePlan).where(DatePlan.conversation_id == conv.id, DatePlan.status.in_(("proposed", "countered", "confirmed", "completed"))).order_by(DatePlan.created_at.desc())).scalars().first()
    if plan is None:
        return None
    # `timezone` is the venue's, and it is here because both apps show this date on the conversation
    # screen and in the Messages list. Without it those two places could only render it on the
    # reader's own clock -- a different time from the one the date detail screen has them agree to.
    return {"date_plan_id": plan.id, "status": plan.status, "starts_at": iso(plan.starts_at), "timezone": plan.timezone}


def summary(db: Session, conv: Conversation, viewer: Member) -> dict[str, Any]:
    from app.models.safety import Block

    other = db.get(Member, conv.other(viewer.id))
    last = db.execute(select(Message).where(Message.conversation_id == conv.id, Message.deleted_at.is_(None)).order_by(Message.sequence.desc()).limit(1)).scalar_one_or_none()
    closed_neutral = conv.status in ("closed", "blocked")
    # The neutral snapshot on a closed conversation is a privacy decision: no name, no photo,
    # no age once it is over. But it also took away the only id the client had, so an ended
    # thread could neither block nor report the person — and reporting afterwards is the
    # ordinary case, not the edge one. A report with no subject reaches a reviewer who cannot
    # act on anybody.
    #
    # So the safety target is carried separately from the profile. It is not a new disclosure:
    # the viewer was handed this id for the whole time the conversation was open.
    blocked_by_viewer = other is not None and (
        db.execute(
            select(Block.id).where(Block.blocker_id == viewer.id, Block.blocked_id == other.id, Block.removed_at.is_(None))
        ).first()
        is not None
    )
    return {
        "id": conv.id,
        "introduction_id": conv.introduction_id,
        "status": "closed" if closed_neutral else conv.status,
        "public_reason": "This conversation has ended." if closed_neutral else None,
        "other": snapshot_for_viewer(db, other, viewer) if other and not closed_neutral else {"member_id": None, "display_name": "Member unavailable", "verified": False, "media": []},
        "last_message": {"text": last.body[:80] if last.moderation_state != "hidden" else "", "sent_at": iso(last.sent_at), "mine": last.sender_id == viewer.id} if last else None,
        "unread": unread_count(db, conv, viewer.id),
        "date": date_status(db, conv),
        "opened_at": iso(conv.opened_at),
        "safety_hold": conv.safety_hold,
        "safety": {"subject_id": other.id if other else None, "blocked_by_you": blocked_by_viewer},
    }


def list_for(db: Session, viewer: Member) -> list[dict[str, Any]]:
    rows = db.execute(select(Conversation).where(or_(Conversation.member_a_id == viewer.id, Conversation.member_b_id == viewer.id)).order_by(Conversation.last_message_at.desc().nullslast(), Conversation.opened_at.desc())).scalars().all()
    return [summary(db, c, viewer) for c in rows]


def message_payload(m: Message, viewer_id: str) -> dict[str, Any]:
    return {"id": m.id, "client_message_id": m.client_message_id, "sequence": m.sequence, "sender_id": m.sender_id, "mine": m.sender_id == viewer_id, "type": m.type, "text": "" if m.moderation_state == "hidden" else m.body, "moderation_state": m.moderation_state, "meta": {k: v for k, v in (m.meta or {}).items() if k in ("source_lang", "draft_assisted", "translated_from")}, "sent_at": iso(m.sent_at)}


def history(db: Session, conv: Conversation, viewer_id: str, cursor: int | None, limit: int = 50) -> dict[str, Any]:
    q = select(Message).where(Message.conversation_id == conv.id, Message.deleted_at.is_(None))
    if cursor:
        q = q.where(Message.sequence < cursor)
    rows = db.execute(q.order_by(Message.sequence.desc()).limit(limit + 1)).scalars().all()
    has_more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    return {"items": [message_payload(m, viewer_id) for m in rows], "next_cursor": rows[0].sequence if has_more and rows else None, "has_more": has_more}


def send_message(db: Session, conv_id: str, sender: Member, client_message_id: str, text: str, msg_type: str = "text", meta: dict[str, Any] | None = None) -> Message:
    conv = db.execute(select(Conversation).where(Conversation.id == conv_id).with_for_update()).scalar_one_or_none()
    if conv is None or not conv.has_participant(sender.id):
        raise ApiError("NOT_FOUND")
    existing = db.execute(select(Message).where(Message.conversation_id == conv.id, Message.client_message_id == client_message_id)).scalar_one_or_none()
    if existing:
        return existing
    if conv.status == "safety_hold" or conv.safety_hold:
        raise ApiError("SAFETY_HOLD", "This conversation is paused while our safety team reviews a report.")
    if conv.status != "active":
        raise ApiError("CONFLICT", "This conversation has ended.")
    text = text.strip()
    if not text or len(text) > 4000:
        raise ApiError("VALIDATION_ERROR", "Write a message between 1 and 4000 characters.", field_errors={"text": "length"})
    from datetime import timedelta

    from sqlalchemy import func

    recent = db.execute(select(func.count(Message.id)).where(Message.sender_id == sender.id, Message.sent_at >= utcnow() - timedelta(hours=1))).scalar() or 0
    if recent >= MAX_MESSAGES_PER_HOUR:
        raise ApiError("RATE_LIMITED", "You are sending messages very quickly. Take a short break.", retry_after=300)
    moderation = "clear"
    flags: list[str] = []
    if SCAM_PATTERNS.search(text):
        moderation, flags = "flagged", ["possible_scam"]
    if ABUSE_PATTERNS.search(text):
        moderation, flags = "flagged", [*flags, "possible_abuse"]
    conv.message_seq += 1
    conv.last_message_at = utcnow()
    msg = Message(conversation_id=conv.id, sender_id=sender.id, client_message_id=client_message_id, sequence=conv.message_seq, type=msg_type, body=text, meta={**(meta or {}), "flags": flags}, moderation_state=moderation)
    db.add(msg)
    db.flush()
    track(db, "message_sent", sender.id, type=msg_type, length_bucket="short" if len(text) < 80 else "long", moderation_state=moderation)
    if meta and meta.get("draft_id"):
        track(db, "ai_draft_used", sender.id, edit_distance_bucket=meta.get("edit_bucket", "unknown"), time_to_send_bucket="<1h")
    if flags:
        audit(db, actor_type="system", actor_id=None, action="message.flagged", resource_type="message", resource_id=msg.id, metadata={"flags": flags})
    other = conv.other(sender.id)
    event = {"type": "conversation.message.created", "conversation_id": conv.id, "message": message_payload(msg, other), "sequence": msg.sequence, "occurred_at": iso(msg.sent_at)}
    hub.push(other, event)
    hub.push(sender.id, {**event, "message": message_payload(msg, sender.id)})
    notify(db, other, "message_received", "conversations", "New message", f"{db.get(Member, sender.id) and (db.get(__import__('app.models.profile', fromlist=['Profile']).Profile, sender.id).display_name or 'Your match')} sent you a message.", f"/messages/{conv.id}", dedupe_key=f"msg:{conv.id}:{other}:{msg.sequence // 5}")
    return msg


def mark_read(db: Session, conv: Conversation, member_id: str, sequence: int) -> None:
    """Advance the member's read cursor, never rewind it, whatever order the requests arrive in.

    Written as one upsert because two things race here and both have bitten. Reading the row and
    computing the new value in Python protects only requests that do not overlap: two tabs, or a newer
    message arriving before the previous POST finishes, can both read the same cursor and the older
    sequence can commit last — putting messages the member has read back to unread. And when there is
    no row yet, two concurrent first reads both insert and one dies on `uq_read_cursor`.

    `GREATEST` in the conflict clause settles both inside a single statement: the row is locked for the
    update by Postgres, the comparison happens against whatever is committed at that moment rather than
    against what this transaction read earlier, and the insert path needs no separate existence check.

    It replaced `max(cursor.last_read_sequence, sequence)` on a freshly added row, where
    `last_read_sequence` was still None because `default=0` is a column default applied by the INSERT.
    That raised, the 500 rolled the transaction back so the row was never written, and the next call
    raised again — so `read_cursors` stayed empty and nobody's unread count ever cleared.
    """
    now = utcnow()
    # Clamped to the conversation's head, read inside the same statement.
    #
    # Nothing stopped a client sending a sequence higher than any message that exists, and
    # `GREATEST` below then made it permanent: `unread_count` counts messages *above* the cursor, so
    # a cursor past the end marks every real message read and every future one too, until the
    # conversation catches up with whatever number was sent. A client bug would be enough, and the
    # member has no way to undo it — their unread badge simply never comes back.
    #
    # One clamp, applied to the inserted value, so the conflict path below inherits it through
    # `excluded` rather than repeating the bound and having to agree with it.
    head = select(Conversation.message_seq).where(Conversation.id == conv.id).scalar_subquery()
    insert = pg_insert(ReadCursor).values(
        id=new_id(),
        conversation_id=conv.id,
        member_id=member_id,
        last_read_sequence=func.least(sequence, head),
        updated_at=now,
    )
    db.execute(
        insert.on_conflict_do_update(
            constraint="uq_read_cursor",
            set_={
                "last_read_sequence": func.greatest(ReadCursor.__table__.c.last_read_sequence, insert.excluded.last_read_sequence),
                "updated_at": now,
            },
        )
    )


def close(db: Session, conv_id: str, member: Member, reason: str, private_note: str | None, block: bool) -> dict[str, Any]:
    conv = db.execute(select(Conversation).where(Conversation.id == conv_id).with_for_update()).scalar_one_or_none()
    if conv is None or not conv.has_participant(member.id):
        raise ApiError("NOT_FOUND")
    other_id = conv.other(member.id)
    if conv.status == "active":
        conv.status = "closed"
        conv.closed_at = utcnow()
        conv.closed_by = member.id
        conv.close_reason = "respectful_close"
        for plan in db.execute(select(DatePlan).where(DatePlan.conversation_id == conv.id, DatePlan.status.in_(("draft", "proposed", "countered", "confirmed")))).scalars():
            plan.status = "cancelled"
            plan.cancelled_at = utcnow()
            plan.cancel_reason = "conversation_closed"
        # The other member sees a neutral close; no negotiation prompt.
        notify(db, other_id, "conversation_closed", "conversations", "A conversation ended", "This connection has closed. You can keep using the app as usual.", "/messages", dedupe_key=f"closed:{conv.id}:{other_id}")
        hub.push(other_id, {"type": "conversation.closed", "conversation_id": conv.id, "public_reason_code": "ended"})
    audit(db, actor_type="member", actor_id=member.id, action="conversation.closed", resource_type="conversation", resource_id=conv.id, metadata={"reason": reason})
    if block:
        from app.modules.safety.service import create_block

        create_block(db, member, other_id, source="member")
    return {"conversation_id": conv.id, "status": "closed", "blocked": block}
