"""Session tokens. Access tokens are short lived JWTs; refresh tokens are opaque and hashed at rest."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Any

import jwt

from app.core.config import get_settings
from app.core.timeutil import utcnow


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def new_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def create_access_token(member_id: str, session_id: str, roles: list[str]) -> str:
    settings = get_settings()
    now = utcnow()
    payload: dict[str, Any] = {
        "sub": member_id,
        "sid": session_id,
        "roles": roles,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.access_token_ttl_seconds)).timestamp()),
        "typ": "access",
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != "access":
        return None
    return payload


def sign_webhook(secret: str, body: bytes, timestamp: str) -> str:
    return hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + body, hashlib.sha256).hexdigest()


def verify_webhook(secret: str, body: bytes, timestamp: str, signature: str, tolerance_seconds: int = 300) -> bool:
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(int(utcnow().timestamp()) - ts) > tolerance_seconds:
        return False
    expected = sign_webhook(secret, body, timestamp)
    return hmac.compare_digest(expected, signature or "")
