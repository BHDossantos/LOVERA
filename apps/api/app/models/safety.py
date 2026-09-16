from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column

SAFETY_CASE_STATUSES = ("submitted", "triaged", "assigned", "in_review", "actioned", "awaiting_information", "closed", "appealed")
SEVERITIES = ("P0", "P1", "P2", "P3")
REPORT_CATEGORIES = {
    "imminent_danger": "P0",
    "child_safety": "P0",
    "sexual_violence": "P1",
    "stalking": "P1",
    "threats": "P1",
    "intimate_image_abuse": "P1",
    "extortion": "P1",
    "harassment": "P2",
    "coercion": "P2",
    "scam_or_fraud": "P2",
    "impersonation": "P2",
    "hate_or_discrimination": "P2",
    "misleading_profile": "P3",
    "no_show": "P3",
    "rude_or_disrespectful": "P3",
    "other": "P3",
}


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"),
        Index("ix_block_blocked", "blocked_id"),
    )

    id: Mapped[str] = id_column()
    blocker_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    blocked_id: Mapped[str] = mapped_column(String(36), nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="member", nullable=False)  # member | report | staff
    created_at: Mapped[datetime] = created_at_column()
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SafetyReport(Base):
    __tablename__ = "safety_reports"
    __table_args__ = (UniqueConstraint("reporter_id", "idempotency_key", name="uq_report_idem"),)

    id: Mapped[str] = id_column()
    receipt_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    reporter_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    subject_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    date_plan_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(2), nullable=False)
    urgency: Mapped[str] = mapped_column(String(16), default="not_urgent", nullable=False)  # happening_now | recent | past | not_urgent
    narrative: Mapped[str | None] = mapped_column(String(4000), nullable=True)  # restricted; envelope-encrypted at rest
    status: Mapped[str] = mapped_column(String(24), default="submitted", nullable=False, index=True)
    assigned_reviewer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolution_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    specialist_workflow: Mapped[str | None] = mapped_column(String(32), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submitted_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SafetyEvidence(Base):
    __tablename__ = "safety_evidence"

    id: Mapped[str] = id_column()
    report_id: Mapped[str] = mapped_column(ForeignKey("safety_reports.id", ondelete="CASCADE"), nullable=False, index=True)
    storage_key: Mapped[str] = mapped_column(String(256), nullable=False)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    retention_class: Mapped[str] = mapped_column(String(16), default="case", nullable=False)
    access_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    collected_at: Mapped[datetime] = created_at_column()


class SafetyAction(Base):
    __tablename__ = "safety_actions"
    __table_args__ = (Index("ix_safety_action_subject_active", "subject_id", "starts_at", "ends_at"),)

    id: Mapped[str] = id_column()
    subject_id: Mapped[str] = mapped_column(String(36), nullable=False)
    report_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    type: Mapped[str] = mapped_column(String(24), nullable=False)  # protective_block | warning | capability_limit | restrict | suspend | ban
    scope: Mapped[str] = mapped_column(String(24), default="account", nullable=False)
    starts_at: Mapped[datetime] = created_at_column()
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason_code: Mapped[str] = mapped_column(String(48), nullable=False)
    decision_source: Mapped[str] = mapped_column(String(8), default="rule", nullable=False)  # rule | human
    reviewer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    appealable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    public_notice: Mapped[str | None] = mapped_column(String(300), nullable=True)
    lifted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_at_column()

    def active(self, now: datetime) -> bool:
        if self.lifted_at is not None:
            return False
        if self.ends_at is not None and self.ends_at <= now:
            return False
        return True


class Appeal(Base):
    __tablename__ = "appeals"

    id: Mapped[str] = id_column()
    safety_action_id: Mapped[str] = mapped_column(ForeignKey("safety_actions.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    statement: Mapped[str] = mapped_column(String(4000), nullable=False)  # restricted
    status: Mapped[str] = mapped_column(String(16), default="submitted", nullable=False)  # submitted | in_review | decided
    assigned_reviewer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)  # upheld | overturned | modified
    rationale_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    created_at: Mapped[datetime] = created_at_column()


class CaseNote(Base):
    __tablename__ = "case_notes"

    id: Mapped[str] = id_column()
    report_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(String(36), nullable=False)
    author_role: Mapped[str] = mapped_column(String(24), nullable=False)  # reporter | reviewer
    note: Mapped[str] = mapped_column(String(2000), nullable=False)
    visible_to_reporter: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = created_at_column()
