"""Minimal object store adapter. Production uses EU-region buckets with signed URLs; the pilot keeps an in-database blob table."""
from __future__ import annotations

from app.core.db import session_factory
from app.models.profile import MediaBlob


def put_object(storage_key: str, data_url: str) -> None:
    db = session_factory()()
    try:
        existing = db.get(MediaBlob, storage_key)
        if existing:
            existing.data_url = data_url
        else:
            db.add(MediaBlob(storage_key=storage_key, data_url=data_url))
        db.commit()
    finally:
        db.close()


def get_object(storage_key: str) -> str | None:
    db = session_factory()()
    try:
        row = db.get(MediaBlob, storage_key)
        return row.data_url if row else None
    finally:
        db.close()
