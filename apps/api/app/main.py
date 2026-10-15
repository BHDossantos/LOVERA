from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_engine, session_factory
from app.core.errors import ApiError, api_error_handler, error_payload
from app.core.events import drain
from app.core.mail import get_sender
from app.models import Base

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("app")


# Any int64 will do; it only has to be the same in every process that creates the schema.
SCHEMA_LOCK_KEY = 0x6D6D_5343_4845_4D41  # "mmSCHEMA"


def create_schema() -> None:
    """Create any missing tables, one process at a time.

    create_all checks for each table and then creates it, and those two steps are not
    atomic. Two processes starting together — several API replicas, or the API and the
    seeder in CI — both see "members" missing and both issue CREATE TABLE; the loser
    dies with a duplicate pg_type entry rather than a friendly "already exists".

    A transaction-scoped advisory lock serialises them. The second caller blocks until
    the first commits, then finds the tables present and creates nothing. The lock is
    released with the transaction, so a process that crashes mid-creation cannot wedge
    the rest, and Postgres's transactional DDL means a partial schema is never left
    behind either.
    """
    with get_engine().begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SCHEMA_LOCK_KEY})
        Base.metadata.create_all(bind=conn)


def check_mail_transport() -> None:
    """Refuse to start an API that gives a member no way to receive a sign-in code.

    Sign-in is a one-time code sent by email, and some deployments also return that code
    in the response body. A deploy where *neither* is true looks perfectly healthy — every
    endpoint answers, every check is green — while every single member who asks to sign in
    waits for a mail that will never arrive. That is worth refusing to boot over, because
    the alternative is finding it from the first member who cannot get in.

    The condition is "no member could get the code", not "this is production". It used to be
    the latter, on the reasoning that outside production the code comes back in the response
    — which stops being true the moment `MM_EXPOSE_DEV_OTP` is turned off, and turning it off
    is exactly what a reachable staging deploy has to do, since a public API that hands the
    code to whoever asks lets anyone sign in as anyone. So staging fell through the gap this
    guard exists to close: no mail, no code in the response, and a clean boot.

    An operator who really wants to run without mail can say so with MM_MAIL_TRANSPORT=console,
    which boots and complains instead.
    """
    settings = get_settings()
    # The two ways a code can reach somebody. Either is enough; neither is a dead end.
    mailed = settings.resolved_mail_transport != "console"
    in_response = settings.expose_dev_otp and not settings.is_production
    if not mailed and not in_response:
        where = "in production" if settings.is_production else f'with MM_EXPOSE_DEV_OTP off in "{settings.env}"'
        if settings.mail_transport == "auto":
            raise RuntimeError(
                "No mail host is configured and the sign-in code is not returned in the response "
                f"({where}), so no member could receive one. Set MM_SMTP_HOST (plus "
                "MM_SMTP_USERNAME, MM_SMTP_PASSWORD and MM_MAIL_FROM), or set "
                "MM_MAIL_TRANSPORT=console to start without mail on purpose."
            )
        log.critical("MM_MAIL_TRANSPORT=console %s: sign-in codes are written to this log and delivered to nobody.", where)
    log.info("mail: %s", get_sender().preflight())


def check_identity_provider() -> None:
    """Refuse to start a production API where nobody can finish signing up.

    Onboarding hard-gates on verification (`account.service.advance_onboarding`), and the sandbox
    provider's completion endpoint is correctly refused in production. So `MM_IDENTITY_PROVIDER`
    left at its default in production is a dead end for every member: they sign up, reach step 2
    of 6, and stop — with every endpoint answering and every health check green. That is the same
    shape of failure as a deploy with no mail host, and it is worth refusing to boot over for the
    same reason.

    There are two honest answers and the operator has to pick one. A real vendor, or
    `MM_IDENTITY_PROVIDER=manual_review`, which says out loud that a person approves every signup
    from the admin queue. The second is a workable pilot posture; what it must not be is something
    discovered on launch day.
    """
    settings = get_settings()
    if settings.is_production and settings.identity_provider == "sandbox":
        raise RuntimeError(
            "MM_IDENTITY_PROVIDER is 'sandbox' in production. The sandbox completion endpoint is "
            "refused in production, and onboarding cannot be finished without a verification "
            "result, so every signup would stop at the verification step. Configure a real "
            "identity vendor, or set MM_IDENTITY_PROVIDER=manual_review to approve each member by "
            "hand from the admin verification queue."
        )
    if settings.identity_provider == "manual_review":
        log.warning("MM_IDENTITY_PROVIDER=manual_review: every signup waits for a person in the admin verification queue.")
    log.info("identity: %s", settings.identity_provider)


def check_store_validation() -> None:
    """Say out loud whether the phone can sell anything, and why not.

    This one warns rather than refusing to boot, because the failure is already closed: with no
    validator configured, `/plans` tells the app the store is off and the app draws no purchase
    UI, so nothing is broken and nothing is given away. What it must not be is *silent* — an
    operator who sets up App Store Connect, ships a build and then finds nobody can buy should
    read the reason in the first ten lines of the log rather than in a support ticket.

    `sandbox` in production is the dangerous one, and it is refused at the endpoint rather than
    here: taking the whole API down over a billing setting would be a worse outcome than the
    purchases being off.
    """
    settings = get_settings()
    mode = settings.store_validation
    if mode == "disabled":
        log.info("store: in-app purchase is off (MM_STORE_VALIDATION=disabled). The apps will not offer one.")
    elif mode == "sandbox" and settings.is_production:
        log.warning(
            "MM_STORE_VALIDATION=sandbox in production: receipts would be taken at face value, so "
            "in-app purchase is refused. Set MM_STORE_VALIDATION=app_store or play_store."
        )
    elif mode == "sandbox":
        log.warning("MM_STORE_VALIDATION=sandbox: store receipts are trusted without verification. Never use this in production.")
    else:
        # Choosing a validator is not the same as being able to run it, and the difference is
        # invisible until the first member taps Subscribe. `/plans` already reports the store as
        # off in that case so no button is drawn — but the operator who set this up deliberately
        # should read why in the boot log, not work it out from an empty Membership screen.
        from app.modules.billing import stores

        missing = stores.missing_configuration(mode)
        if missing:
            log.warning("MM_STORE_VALIDATION=%s but %s In-app purchase stays off.", mode, missing)
        else:
            log.info("store: receipts verified by %s", mode)


@asynccontextmanager
async def lifespan(app: FastAPI):
    check_mail_transport()
    check_identity_provider()
    check_store_validation()
    create_schema()
    from app.jobs import register_handlers

    register_handlers()
    from app.modules.dates.venues import seed_venues

    db = session_factory()()
    try:
        seed_venues(db)
        db.commit()
    finally:
        db.close()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Lovera API", version="0.1.0", lifespan=lifespan, docs_url="/v1/docs", openapi_url="/v1/openapi.json")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id", "ETag"],
    )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request.state.request_id = request.headers.get("X-Request-Id") or f"req_{uuid.uuid4().hex[:16]}"
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
            db = session_factory()()
            try:
                drain(db)
            finally:
                db.close()
        return response

    app.add_exception_handler(ApiError, api_error_handler)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        fields = {}
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query", "path"))
            fields[loc or "body"] = err.get("msg", "invalid")
        api_err = ApiError("VALIDATION_ERROR", "Some fields need attention.", field_errors=fields)
        rid = getattr(request.state, "request_id", "unknown")
        return JSONResponse(status_code=422, content=error_payload(api_err, rid), headers={"X-Request-Id": rid})

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception):
        rid = getattr(request.state, "request_id", "unknown")
        log.exception("unhandled error request_id=%s", rid)
        return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL", "message": "Something went wrong. Please try again.", "request_id": rid, "retryable": True}}, headers={"X-Request-Id": rid})

    from app.modules.router import api_router

    app.include_router(api_router, prefix="/v1")

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "env": settings.env}

    return app


app = create_app()
