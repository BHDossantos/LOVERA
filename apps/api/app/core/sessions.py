"""The lifecycle of a signed-in session: rotation, the overlap after it, and replay.

This lives in `core` rather than beside the rest of the account module because `core.deps` is what
reads a session on every authenticated request, and `core` must not import from `modules`.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.timeutil import utcnow
from app.models.account import Session as MemberSession
from app.models.account import SessionLineage

log = logging.getLogger("app.sessions")

# How long a superseded refresh token keeps working after its replacement was issued. It usually ends
# long before this — the moment the replacement's own token is used — so this only bounds the case
# where the client never came back at all, which is the case a thief would be relying on.
SUPERSEDED_GRACE = timedelta(seconds=120)


def lineage_of(db: Session, session: MemberSession) -> SessionLineage:
    """This session's place in its chain, created on demand.

    Sessions issued before this table existed have no row, and signing those members out to
    introduce a security improvement would be its own small outage. A missing row is read as "the
    start of its own chain, already in use", which is exactly what an un-rotated session is.
    """
    row = db.get(SessionLineage, session.id)
    if row is None:
        row = SessionLineage(session_id=session.id, chain_id=session.id, first_used_at=utcnow())
        db.add(row)
        db.flush()
    return row


def session_is_live(db: Session, session: MemberSession) -> bool:
    """Whether this session may still be used, including the brief overlap after a rotation.

    A session that has been rotated away from is *superseded*, not revoked. It keeps working until
    whichever comes first: its replacement's own token is used, or the grace period runs out. That is
    the whole fix for being signed out by an interrupted refresh — the client retrying with the token
    it still holds finds it alive — and it hands nothing to a second holder, because the retry mints a
    fresh replacement rather than re-serving one.
    """
    if session.revoked_at is not None or session.expires_at <= utcnow():
        return False
    row = db.get(SessionLineage, session.id)
    if row is None or row.superseded_at is None:
        return True
    if utcnow() - row.superseded_at > SUPERSEDED_GRACE:
        return False
    successor = db.get(SessionLineage, row.successor_id) if row.successor_id else None
    return successor is None or successor.first_used_at is None


def mark_session_used(db: Session, session: MemberSession) -> None:
    """The first presentation of a session's own token retires the one it replaced.

    This is what keeps the overlap window down to a round trip in practice: as soon as the client
    proves it stored the new token — by using it — the old one is no good to anybody.
    """
    row = lineage_of(db, session)
    if row.first_used_at is not None:
        return
    row.first_used_at = utcnow()
    if row.parent_id:
        parent = db.get(MemberSession, row.parent_id)
        if parent is not None and parent.revoked_at is None:
            parent.revoked_at = utcnow()


def revoke_chain(db: Session, chain_id: str) -> int:
    """Every session descended from one sign-in, ended at once. Returns how many were still live."""
    ids = list(db.execute(select(SessionLineage.session_id).where(SessionLineage.chain_id == chain_id)).scalars().all())
    ids.append(chain_id)  # the chain's own first session, whose row may predate this table
    result = db.execute(
        update(MemberSession).where(MemberSession.id.in_(set(ids)), MemberSession.revoked_at.is_(None)).values(revoked_at=utcnow())
    )
    return result.rowcount or 0
