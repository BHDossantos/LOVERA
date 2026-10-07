from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column

MEMBER_STATUSES = (
    "pending_consent",
    "pending_verification",
    "onboarding",
    "active",
    "paused",
    "restricted",
    "deletion_pending",
    "deleted",
)
ONBOARDING_STEPS = ("account", "verification", "intent", "blueprint", "blueprint_review", "profile", "availability", "done")
ROLES = ("member", "concierge", "safety_reviewer", "support", "admin")


class Member(Base):
    __tablename__ = "members"

    id: Mapped[str] = id_column()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    email_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending_consent", nullable=False, index=True)
    onboarding_step: Mapped[str] = mapped_column(String(32), default="account", nullable=False)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    locale: Mapped[str] = mapped_column(String(8), default="en", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Rome", nullable=False)
    market_id: Mapped[str] = mapped_column(String(32), default="rome", nullable=False, index=True)
    home_city_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    home_zone_id: Mapped[str | None] = mapped_column(String(48), nullable=True)
    # Matching-only eligibility facts (never public beyond the introduction snapshot policy)
    gender: Mapped[str | None] = mapped_column(String(32), nullable=True)
    seeking: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    intent: Mapped[str | None] = mapped_column(String(32), nullable=True)
    max_distance_km: Mapped[int] = mapped_column(Integer, default=25, nullable=False)
    relocation_openness: Mapped[str | None] = mapped_column(String(16), nullable=True)
    date_ready: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    roles: Mapped[list[Any]] = mapped_column(JSON, default=lambda: ["member"], nullable=False)
    risk_flags: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)  # restricted
    invite_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deletion_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    def has_role(self, role: str) -> bool:
        return role in (self.roles or [])

    @property
    def is_staff(self) -> bool:
        return any(r in ("concierge", "safety_reviewer", "support", "admin") for r in (self.roles or []))


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ip_risk_summary: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = created_at_column()


class AuthChallenge(Base):
    __tablename__ = "auth_challenges"

    id: Mapped[str] = id_column()
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_at_column()


class ConsentRecord(Base):
    __tablename__ = "consent_records"
    __table_args__ = (Index("ix_consent_member_purpose", "member_id", "purpose"),)

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # granted | revoked
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="app", nullable=False)
    proof_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
