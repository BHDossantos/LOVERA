"""Error catalog (specification Section E). Clients branch on `code`, never on text."""
from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

CATALOG: dict[str, int] = {
    "AUTH_REQUIRED": 401,
    "FORBIDDEN": 403,
    "VERIFICATION_REQUIRED": 403,
    "ACCOUNT_RESTRICTED": 403,
    "ONBOARDING_INCOMPLETE": 403,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "IDEMPOTENCY_CONFLICT": 409,
    "VALIDATION_ERROR": 422,
    "RATE_LIMITED": 429,
    "INVENTORY_UNAVAILABLE": 409,
    "AI_UNAVAILABLE": 503,
    "DEPENDENCY_UNAVAILABLE": 503,
    "SAFETY_HOLD": 423,
    "VERSION_MISMATCH": 409,
}


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        field_errors: dict[str, str] | None = None,
        retryable: bool = False,
        retry_after: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if code not in CATALOG:
            raise ValueError(f"unknown error code {code}")
        self.code = code
        self.status = CATALOG[code]
        self.message = message or code.replace("_", " ").capitalize()
        self.field_errors = field_errors or {}
        self.retryable = retryable
        self.retry_after = retry_after
        self.extra = extra or {}
        super().__init__(self.message)


def error_payload(err: ApiError, request_id: str) -> dict[str, Any]:
    body: dict[str, Any] = {
        "error": {
            "code": err.code,
            "message_key": f"errors.{err.code.lower()}",
            "message": err.message,
            "field_errors": err.field_errors,
            "retryable": err.retryable,
            "request_id": request_id,
        }
    }
    if err.retry_after is not None:
        body["error"]["retry_after"] = err.retry_after
    if err.extra:
        body["error"].update(err.extra)
    return body


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    headers = {"X-Request-Id": request_id}
    if exc.retry_after is not None:
        headers["Retry-After"] = str(exc.retry_after)
    return JSONResponse(status_code=exc.status, content=error_payload(exc, request_id), headers=headers)
