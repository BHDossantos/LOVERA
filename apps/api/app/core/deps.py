"""Request scoped dependencies: current member, role checks, capability checks."""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import decode_access_token
from app.core.timeutil import utcnow
from app.models.account import Member
from app.models.account import Session as MemberSession


@dataclass
class Principal:
    member: Member
    session_id: str
    roles: list[str]
    request_id: str

    @property
    def id(self) -> str:
        return self.member.id

    def has_role(self, *roles: str) -> bool:
        return any(r in self.roles for r in roles)


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


def current_principal(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> Principal:
    token = _bearer(authorization)
    payload = decode_access_token(token) if token else None
    if not payload:
        raise ApiError("AUTH_REQUIRED", "Sign in to continue.")
    session = db.get(MemberSession, payload["sid"])
    if session is None or session.revoked_at is not None or session.expires_at <= utcnow():
        raise ApiError("AUTH_REQUIRED", "Your session has ended. Sign in again.")
    member = db.get(Member, payload["sub"])
    if member is None or member.status == "deleted":
        raise ApiError("AUTH_REQUIRED", "Sign in to continue.")
    member.last_active_at = utcnow()
    session.last_seen_at = utcnow()
    return Principal(member=member, session_id=session.id, roles=list(member.roles or ["member"]), request_id=getattr(request.state, "request_id", ""))


def active_member(principal: Principal = Depends(current_principal)) -> Principal:
    """Member with a completed onboarding and no account restriction."""
    status = principal.member.status
    if status == "restricted":
        raise ApiError("ACCOUNT_RESTRICTED", "Your account is under review.")
    if status in ("pending_consent", "pending_verification", "onboarding"):
        raise ApiError("ONBOARDING_INCOMPLETE", "Finish onboarding first.", extra={"onboarding_step": principal.member.onboarding_step})
    if status == "deletion_pending":
        raise ApiError("ACCOUNT_RESTRICTED", "This account is scheduled for deletion. Cancel deletion to continue.")
    return principal


def require_roles(*roles: str):
    def dependency(principal: Principal = Depends(current_principal)) -> Principal:
        if not principal.has_role(*roles) and not principal.has_role("admin"):
            raise ApiError("FORBIDDEN", "You do not have access to this workspace.")
        return principal

    return dependency


def member_by_id(db: Session, member_id: str) -> Member:
    member = db.get(Member, member_id)
    if member is None:
        raise ApiError("NOT_FOUND")
    return member


def find_member_by_email(db: Session, email: str) -> Member | None:
    return db.execute(select(Member).where(Member.email == email.lower().strip())).scalar_one_or_none()
