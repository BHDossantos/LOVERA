from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column

INTRODUCTION_STATUSES = ("draft", "offered", "mutual", "declined", "expired", "withdrawn", "closed")


class Introduction(Base):
    __tablename__ = "introductions"
    __table_args__ = (
        Index("ix_intro_member_a_status", "member_a_id", "status"),
        Index("ix_intro_member_b_status", "member_b_id", "status"),
        Index("ix_intro_status_expires", "status", "expires_at"),
    )

    id: Mapped[str] = id_column()
    candidate_pair_id: Mapped[str | None] = mapped_column(ForeignKey("candidate_pairs.id"), nullable=True, unique=True)
    match_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    member_a_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    member_b_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)
    offered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extension_used_by: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    explanation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_trial_for: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    closed_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = created_at_column()

    def participants(self) -> tuple[str, str]:
        return (self.member_a_id, self.member_b_id)

    def other(self, member_id: str) -> str:
        return self.member_b_id if member_id == self.member_a_id else self.member_a_id


class IntroDecision(Base):
    __tablename__ = "intro_decisions"
    __table_args__ = (
        UniqueConstraint("introduction_id", "member_id", name="uq_intro_decision_member"),
        UniqueConstraint("member_id", "idempotency_key", name="uq_intro_decision_idem"),
    )

    id: Mapped[str] = id_column()
    introduction_id: Mapped[str] = mapped_column(ForeignKey("introductions.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id: Mapped[str] = mapped_column(String(36), nullable=False)
    decision: Mapped[str] = mapped_column(String(8), nullable=False)  # accept | decline
    reason_codes: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    learning_consent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    decided_at: Mapped[datetime] = created_at_column()
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)


class MatchExplanation(Base):
    __tablename__ = "match_explanations"

    id: Mapped[str] = id_column()
    introduction_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    for_member_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reasons: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    friction: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    unknown: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    evidence_ids: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    data_categories: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    generator_version: Mapped[str] = mapped_column(String(48), nullable=False)
    validated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reviewer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = created_at_column()


class IntroCorrection(Base):
    __tablename__ = "intro_corrections"

    id: Mapped[str] = id_column()
    introduction_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    member_id: Mapped[str] = mapped_column(String(36), nullable=False)
    signal_key: Mapped[str] = mapped_column(String(64), nullable=False)
    corrected_value: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
