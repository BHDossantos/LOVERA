"""Idempotency-Key handling for retryable commands: same key and body returns the stored result."""
from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.timeutil import utcnow
from app.models.privacy import IdempotencyRecord


def body_hash(body: Any) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def lookup(db: Session, scope: str, key: str | None, body: Any) -> dict[str, Any] | None:
    if not key:
        return None
    record = db.execute(select(IdempotencyRecord).where(IdempotencyRecord.scope == scope, IdempotencyRecord.key == key)).scalar_one_or_none()
    if record is None:
        return None
    if record.body_hash != body_hash(body):
        raise ApiError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used with a different request body.")
    return record.response


def store(db: Session, scope: str, key: str | None, body: Any, response: dict[str, Any], status_code: int = 200) -> None:
    if not key:
        return
    db.add(
        IdempotencyRecord(
            scope=scope,
            key=key,
            body_hash=body_hash(body),
            status_code=status_code,
            response=response,
            expires_at=utcnow() + timedelta(hours=24),
        )
    )
