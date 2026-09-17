from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column


class BlueprintSession(Base):
    __tablename__ = "blueprint_sessions"

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)  # active | ready_for_review | completed
    mode: Mapped[str] = mapped_column(String(16), default="initial", nullable=False)  # initial | refresh
    answers: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)  # [{question_key, input_mode, raw, extracted:[...]}]
    proposed_signals: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    current_question_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BlueprintVersion(Base):
    __tablename__ = "blueprint_versions"
    __table_args__ = (UniqueConstraint("member_id", "version_no", name="uq_blueprint_member_version"),)

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)  # draft | confirmed | superseded
    source_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BlueprintSignal(Base):
    __tablename__ = "blueprint_signals"
    __table_args__ = (UniqueConstraint("blueprint_version_id", "key", name="uq_blueprint_signal_key"),)

    id: Mapped[str] = id_column()
    blueprint_version_id: Mapped[str] = mapped_column(ForeignKey("blueprint_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    normalized_value: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)  # {"value": ...}
    confidence: Mapped[str] = mapped_column(String(16), default="promising", nullable=False)  # strong|promising|low_evidence
    evidence_refs: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    member_corrected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    freshness_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Preference(Base):
    __tablename__ = "preferences"
    __table_args__ = (UniqueConstraint("member_id", "key", name="uq_preference_member_key"),)

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    tier: Mapped[str] = mapped_column(String(8), nullable=False)  # must | prefer | open
    operator: Mapped[str] = mapped_column(String(8), default="in", nullable=False)  # in | range | eq
    value: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    visibility: Mapped[str] = mapped_column(String(16), default="matching", nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
