from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.db import get_engine, session_factory
from app.core.errors import ApiError, api_error_handler, error_payload
from app.core.events import drain
from app.models import Base

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("app")


def create_schema() -> None:
    Base.metadata.create_all(get_engine())


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    app = FastAPI(title="AI Matchmaker API", version="0.1.0", lifespan=lifespan, docs_url="/v1/docs", openapi_url="/v1/openapi.json")
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
