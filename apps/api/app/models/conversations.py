from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column

CONVERSATION_STATUSES = ("active", "closed", "blocked", "safety_hold")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = id_column()
    introduction_id: Mapped[str] = mapped_column(ForeignKey("introductions.id"), nullable=False, unique=True)
    member_a_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    member_b_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    opened_at: Mapped[datetime] = created_at_column()
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)  # public reason code
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    message_seq: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    safety_hold: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    def other(self, member_id: str) -> str:
        return self.member_b_id if member_id == self.member_a_id else self.member_a_id

    def has_participant(self, member_id: str) -> bool:
        return member_id in (self.member_a_id, self.member_b_id)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "client_message_id", name="uq_message_client_id"),
        Index("ix_message_conversation_seq", "conversation_id", "sequence"),
    )

    id: Mapped[str] = id_column()
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    sender_id: Mapped[str] = mapped_column(String(36), nullable=False)
    client_message_id: Mapped[str] = mapped_column(String(64), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(16), default="text", nullable=False)  # text | voice | system
    body: Mapped[str] = mapped_column(String(4000), nullable=False)  # envelope-encrypted at rest by platform policy
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)  # {draft_id, translation_id, source_lang}
    moderation_state: Mapped[str] = mapped_column(String(16), default="clear", nullable=False)  # clear | flagged | hidden
    sent_at: Mapped[datetime] = created_at_column()
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReadCursor(Base):
    __tablename__ = "read_cursors"
    __table_args__ = (UniqueConstraint("conversation_id", "member_id", name="uq_read_cursor"),)

    id: Mapped[str] = id_column()
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    member_id: Mapped[str] = mapped_column(String(36), nullable=False)
    last_read_sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
