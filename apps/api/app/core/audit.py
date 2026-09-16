"""Tamper-evident audit trail. Metadata must already be redacted by the caller."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.privacy import AuditEvent

REDACT_KEYS = {"body", "narrative", "statement", "email", "token", "lat", "lon", "location", "storage_key", "draft_text"}


def redact(meta: dict[str, Any] | None) -> dict[str, Any]:
    if not meta:
        return {}
    return {k: ("[redacted]" if k in REDACT_KEYS else v) for k, v in meta.items()}


def audit(
    db: Session,
    *,
    actor_type: str,
    actor_id: str | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    purpose: str | None = None,
    request_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    prev = db.execute(select(AuditEvent.hash).order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc()).limit(1)).scalar()
    safe_meta = redact(metadata)
    digest_source = json.dumps(
        {"prev": prev, "actor": actor_id, "action": action, "resource": f"{resource_type}:{resource_id}", "meta": safe_meta},
        sort_keys=True,
        default=str,
    )
    event = AuditEvent(
        actor_type=actor_type,
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        purpose=purpose,
        request_id=request_id,
        redacted_metadata=safe_meta,
        prev_hash=prev,
        hash=hashlib.sha256(digest_source.encode("utf-8")).hexdigest(),
    )
    db.add(event)
    return event
