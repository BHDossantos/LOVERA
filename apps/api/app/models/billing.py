from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column

SUBSCRIPTION_STATUSES = ("trialing", "active", "past_due", "paused", "cancelled", "expired")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_customer_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_subscription_ref: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    plan: Mapped[str] = mapped_column(String(16), nullable=False)  # pro | concierge
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    started_at: Mapped[datetime] = created_at_column()
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(48), nullable=True)


class CheckoutSession(Base):
    __tablename__ = "checkout_sessions"
    __table_args__ = (UniqueConstraint("member_id", "idempotency_key", name="uq_checkout_idem"),)

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    plan: Mapped[str] = mapped_column(String(16), nullable=False)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False)  # open | completed | expired
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CreditLedger(Base):
    __tablename__ = "credit_ledger"

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(48), nullable=False)
    reference: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)  # immutable dedupe reference
    introduction_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    match_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_at_column()


class WebhookReceipt(Base):
    __tablename__ = "webhook_receipts"
    __table_args__ = (UniqueConstraint("provider", "provider_event_id", name="uq_webhook_event"),)

    id: Mapped[str] = id_column()
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    body_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="received", nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    received_at: Mapped[datetime] = created_at_column()
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
