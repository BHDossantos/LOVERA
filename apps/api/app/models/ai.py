from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column


class AIDraft(Base):
    __tablename__ = "ai_drafts"

    id: Mapped[str] = id_column()
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_id: Mapped[str] = mapped_column(String(36), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)  # natural | warm | playful | direct
    goal: Mapped[str] = mapped_column(String(32), nullable=False)
    context_message_ids: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    draft_text: Mapped[str] = mapped_column(String(2000), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    safety_labels: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    accepted_text_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ready", nullable=False)  # ready | used | discarded
    created_at: Mapped[datetime] = created_at_column()


class Translation(Base):
    __tablename__ = "translations"

    id: Mapped[str] = id_column()
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    requester_id: Mapped[str] = mapped_column(String(36), nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String(36), nullable=True)  # message id or draft id
    source_lang: Mapped[str] = mapped_column(String(8), nullable=False)
    target_lang: Mapped[str] = mapped_column(String(8), nullable=False)
    source_text: Mapped[str] = mapped_column(String(4000), nullable=False)
    translated_text: Mapped[str] = mapped_column(String(4000), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.8, nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = created_at_column()
