from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timeutil import iso, utcnow
from app.models.notifications import Notification, PushDevice


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


# --- push devices -------------------------------------------------------------
#
# Registration is idempotent on the token: the platform reissues tokens freely
# (reinstall, restore to a new handset, sometimes an OS upgrade), and the same
# token can arrive again for the same member or move to a different one. Treating
# the token as the key is what stops a stale row pushing somebody's introduction
# to a phone its previous owner sold.


def register_push_device(db: Session, member_id: str, token: str, platform: str, device_id: str | None = None, app_version: str | None = None) -> dict[str, Any]:
    existing = db.execute(select(PushDevice).where(PushDevice.token == token)).scalar_one_or_none()
    if existing:
        existing.member_id = member_id
        existing.platform = platform
        existing.device_id = device_id
        existing.app_version = app_version
        existing.last_seen_at = utcnow()
        existing.revoked_at = None
        device = existing
    else:
        device = PushDevice(member_id=member_id, token=token, platform=platform, device_id=device_id, app_version=app_version, last_seen_at=utcnow())
        db.add(device)
    db.flush()
    return {"id": device.id, "platform": device.platform, "registered": True}


def revoke_push_device(db: Session, member_id: str, token: str | None = None, device_id: str | None = None) -> int:
    """Retire this handset's tokens on sign-out, so the next person to hold the
    phone is never shown who wants to meet the last one."""
    q = select(PushDevice).where(PushDevice.member_id == member_id, PushDevice.revoked_at.is_(None))
    if token:
        q = q.where(PushDevice.token == token)
    elif device_id:
        q = q.where(PushDevice.device_id == device_id)
    count = 0
    for d in db.execute(q).scalars():
        d.revoked_at = utcnow()
        count += 1
    return count


def active_push_tokens(db: Session, member_id: str) -> list[str]:
    rows = db.execute(select(PushDevice.token).where(PushDevice.member_id == member_id, PushDevice.revoked_at.is_(None))).scalars().all()
    return list(rows)
