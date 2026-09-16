from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column


class MatchRun(Base):
    __tablename__ = "match_runs"

    id: Mapped[str] = id_column()
    market_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    cohort_date: Mapped[str] = mapped_column(String(10), nullable=False)
    rules_version: Mapped[str] = mapped_column(String(32), nullable=False)
    model_version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="running", nullable=False)  # running|review|published|failed
    candidate_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    allocation_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    stats: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    triggered_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    started_at: Mapped[datetime] = created_at_column()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CandidatePair(Base):
    __tablename__ = "candidate_pairs"
    __table_args__ = (UniqueConstraint("match_run_id", "member_a_id", "member_b_id", name="uq_candidate_pair_run"),)

    id: Mapped[str] = id_column()
    match_run_id: Mapped[str] = mapped_column(ForeignKey("match_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    member_a_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)  # least id
    member_b_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)  # greatest id
    directional_a: Mapped[float] = mapped_column(Float, nullable=False)
    directional_b: Mapped[float] = mapped_column(Float, nullable=False)
    reciprocal: Mapped[float] = mapped_column(Float, nullable=False)
    practical: Mapped[float] = mapped_column(Float, nullable=False)
    quality: Mapped[float] = mapped_column(Float, nullable=False)
    uncertainty: Mapped[float] = mapped_column(Float, nullable=False)
    penalties: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    pair_score: Mapped[float] = mapped_column(Float, nullable=False)
    feature_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    rank_for_a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rank_for_b: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exposure_propensity: Mapped[float | None] = mapped_column(Float, nullable=True)
    allocated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    review_status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)  # pending|approved|rejected|published
    reviewer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
