from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column


class AvailabilityVersion(Base):
    __tablename__ = "availability_versions"

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    recurring_windows: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)  # [{weekday:0-6, start:"18:00", end:"22:00"}]
    dated_exceptions: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)  # [{date:"2026-09-20", available:false}]
    date_styles: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)  # coffee | walk | dinner | drinks | culture
    calendar_source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    valid_from: Mapped[datetime] = created_at_column()
    created_at: Mapped[datetime] = created_at_column()
