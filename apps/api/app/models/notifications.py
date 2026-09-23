from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notification_member_created", "member_id", "created_at"),)

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(48), nullable=False)
    group: Mapped[str] = mapped_column(String(24), nullable=False)  # introductions | conversations | dates | safety | account
    channel: Mapped[str] = mapped_column(String(16), default="in_app", nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    deep_link: Mapped[str | None] = mapped_column(String(200), nullable=True)
    template_version: Mapped[str] = mapped_column(String(16), default="v1", nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    dedupe_key: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = created_at_column()


class PushDevice(Base):
    """A phone that has agreed to receive pushes.

    Keyed on the push token rather than the device, because the token is what the
    transport actually addresses and the platform reissues it freely — on reinstall,
    on restore to a new handset, sometimes on upgrade. A member may hold several.

    `device_id` is the app's own stable identifier, so signing out on a handset can
    retire exactly that handset's token and no one else's.
    """

    __tablename__ = "push_devices"
    __table_args__ = (
        UniqueConstraint("token", name="uq_push_device_token"),
        Index("ix_push_device_member", "member_id", "revoked_at"),
    )

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    token: Mapped[str] = mapped_column(String(256), nullable=False)
    platform: Mapped[str] = mapped_column(String(12), nullable=False)  # ios | android
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
