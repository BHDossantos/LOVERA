from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON, Base, created_at_column, id_column

INTENTS = ("long_term", "life_partner")  # single serious-relationship lane for the pilot


class Profile(Base):
    __tablename__ = "profiles"

    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    pronouns: Mapped[str | None] = mapped_column(String(32), nullable=True)
    occupation: Mapped[str | None] = mapped_column(String(80), nullable=True)
    education: Mapped[str | None] = mapped_column(String(80), nullable=True)
    bio: Mapped[str | None] = mapped_column(String(600), nullable=True)
    languages: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    prompts: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)  # [{key, answer}]
    voice_media_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    visibility_map: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    moderation_status: Mapped[str] = mapped_column(String(16), default="approved", nullable=False)
    completeness: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProfileMedia(Base):
    __tablename__ = "profile_media"
    __table_args__ = (Index("ix_profile_media_member_position", "member_id", "position"),)

    id: Mapped[str] = id_column()
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # photo | voice | video
    storage_key: Mapped[str] = mapped_column(String(256), nullable=False)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    alt_text: Mapped[str | None] = mapped_column(String(200), nullable=True)
    moderation_status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)  # pending|approved|rejected|review
    upload_state: Mapped[str] = mapped_column(String(16), default="created", nullable=False)  # created|uploaded|complete
    perceptual_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = created_at_column()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MediaBlob(Base):
    """Pilot object store: production uses EU-region buckets with signed URLs."""

    __tablename__ = "media_blobs"

    storage_key: Mapped[str] = mapped_column(String(256), primary_key=True)
    data_url: Mapped[str] = mapped_column(Text, nullable=False)
