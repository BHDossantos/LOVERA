from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column

DATE_PLAN_STATUSES = ("draft", "proposed", "countered", "confirmed", "completed", "cancelled", "no_show", "disputed")


class Venue(Base):
    __tablename__ = "venues"

    id: Mapped[str] = id_column()
    market_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    coarse_area: Mapped[str] = mapped_column(String(64), nullable=False)
    zone_id: Mapped[str] = mapped_column(String(48), nullable=False)
    categories: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    price_band: Mapped[str] = mapped_column(String(8), default="€€", nullable=False)
    accessibility: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    safety_attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    atmosphere: Mapped[str | None] = mapped_column(String(160), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)  # restricted: never serialized to members
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    public_place: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class DatePlan(Base):
    __tablename__ = "date_plans"
    __table_args__ = (Index("ix_date_plan_conv_status_start", "conversation_id", "status", "starts_at"),)

    id: Mapped[str] = id_column()
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    member_a_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    member_b_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    proposed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    venue_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    venue_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    date_style: Mapped[str | None] = mapped_column(String(16), nullable=True)
    confirmations: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)  # member ids confirming current version
    history: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)  # [{by, action, at, changed_fields}]
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = created_at_column()

    def other(self, member_id: str) -> str:
        return self.member_b_id if member_id == self.member_a_id else self.member_a_id

    def has_participant(self, member_id: str) -> bool:
        return member_id in (self.member_a_id, self.member_b_id)


class DateCheckIn(Base):
    __tablename__ = "date_check_ins"
    __table_args__ = (UniqueConstraint("date_plan_id", "member_id", name="uq_checkin_member"),)

    id: Mapped[str] = id_column()
    date_plan_id: Mapped[str] = mapped_column(ForeignKey("date_plans.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[str] = mapped_column(String(36), nullable=False)
    trusted_contact_name: Mapped[str] = mapped_column(String(80), nullable=False)
    trusted_contact_channel: Mapped[str] = mapped_column(String(120), nullable=False)  # restricted
    share_scope: Mapped[str] = mapped_column(String(16), default="plan", nullable=False)  # plan | plan_and_checkin | plan_checkin_location
    check_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    escalation_preference: Mapped[str] = mapped_column(String(16), default="contact", nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="scheduled", nullable=False)  # scheduled | checked_in | missed | escalated | cancelled
    encrypted_location_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_at_column()


class PostDateFeedback(Base):
    __tablename__ = "post_date_feedback"
    __table_args__ = (UniqueConstraint("date_plan_id", "member_id", name="uq_feedback_member"),)

    id: Mapped[str] = id_column()
    date_plan_id: Mapped[str] = mapped_column(ForeignKey("date_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id: Mapped[str] = mapped_column(String(36), nullable=False)
    attendance: Mapped[str] = mapped_column(String(16), nullable=False)  # attended | other_no_show | i_cancelled | not_yet
    felt_safe: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    enjoyed: Mapped[str | None] = mapped_column(String(16), nullable=True)  # yes | somewhat | no
    second_date_answer: Mapped[str | None] = mapped_column(String(8), nullable=True)  # yes | no | unsure
    fit_reasons: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    safety_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    learning_consent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    reveal_state: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)  # pending | revealed_mutual | closed
    submitted_at: Mapped[datetime] = created_at_column()
