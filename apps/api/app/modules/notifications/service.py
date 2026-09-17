from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timeutil import iso, utcnow
from app.models.notifications import Notification


def notify(db: Session, member_id: str, type_: str, group: str, title: str, body: str, deep_link: str | None = None, dedupe_key: str | None = None, payload: dict[str, Any] | None = None) -> Notification | None:
    if dedupe_key and db.execute(select(Notification.id).where(Notification.dedupe_key == dedupe_key)).first():
        return None
    n = Notification(member_id=member_id, type=type_, group=group, title=title, body=body, deep_link=deep_link, dedupe_key=dedupe_key, payload=payload or {}, delivered_at=utcnow())
    db.add(n)
    return n


def list_for(db: Session, member_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = db.execute(select(Notification).where(Notification.member_id == member_id).order_by(Notification.created_at.desc()).limit(limit)).scalars().all()
    return [{"id": n.id, "type": n.type, "group": n.group, "title": n.title, "body": n.body, "deep_link": n.deep_link, "read_at": iso(n.read_at), "created_at": iso(n.created_at)} for n in rows]


def mark_read(db: Session, member_id: str, ids: list[str] | None) -> int:
    q = select(Notification).where(Notification.member_id == member_id, Notification.read_at.is_(None))
    if ids:
        q = q.where(Notification.id.in_(ids))
    count = 0
    for n in db.execute(q).scalars():
        n.read_at = utcnow()
        count += 1
    return count
