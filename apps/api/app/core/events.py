"""Transactional outbox plus an in-process dispatcher. Handlers must be idempotent."""
from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timeutil import utcnow
from app.models.privacy import OutboxEvent

log = logging.getLogger("events")
Handler = Callable[[Session, OutboxEvent], None]
_handlers: dict[str, list[Handler]] = defaultdict(list)


def subscribe(event_type: str, handler: Handler) -> None:
    _handlers[event_type].append(handler)


def publish(db: Session, event_type: str, aggregate_type: str, aggregate_id: str, payload: dict[str, Any], dedupe_key: str | None = None) -> OutboxEvent:
    """Write to the outbox inside the caller's transaction."""
    key = dedupe_key or f"{event_type}:{aggregate_type}:{aggregate_id}:{utcnow().timestamp()}"
    existing = db.execute(select(OutboxEvent).where(OutboxEvent.dedupe_key == key)).scalar_one_or_none()
    if existing:
        return existing
    event = OutboxEvent(type=event_type, aggregate_type=aggregate_type, aggregate_id=aggregate_id, dedupe_key=key, payload=payload, next_attempt_at=utcnow())
    db.add(event)
    return event


def drain(db: Session, limit: int = 200) -> int:
    """Dispatch pending outbox events. Called after commit by the request middleware and by workers."""
    pending = db.execute(select(OutboxEvent).where(OutboxEvent.status == "pending").order_by(OutboxEvent.created_at).limit(limit)).scalars().all()
    processed = 0
    for event in pending:
        try:
            for handler in _handlers.get(event.type, []):
                handler(db, event)
            event.status = "processed"
            event.processed_at = utcnow()
            processed += 1
        except Exception as exc:  # noqa: BLE001
            log.exception("outbox handler failed for %s", event.type)
            event.attempts += 1
            event.last_error = str(exc)[:300]
            if event.attempts >= 5:
                event.status = "dead_letter"
        db.commit()
    return processed
