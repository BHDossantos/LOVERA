"""Lovera's business agent (ported from Jennifer), for admins only.

Off until MM_BUSINESS_AGENT_ENABLED=true and MM_ANTHROPIC_API_KEY are set.
The agent only proposes: the result is returned here and nothing is sent,
posted, stored or changed. The model sees aggregate member counts only,
never names, contact details or profiles.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.business_agent import BUSINESS_AGENT, SHARED_APPROVALS, run_business_task
from app.business_agent.provider import agent_off_reason, provider_from_env
from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import Principal, require_roles
from app.core.errors import ApiError
from app.core.timeutil import utcnow
from app.models.account import Member

router = APIRouter(prefix="/admin/business-agent", tags=["admin"])


class RunIn(BaseModel):
    taskId: str = Field(max_length=40)
    # Optional notes from the admin, such as partner replies to look at. Treated as untrusted.
    notes: str | None = Field(default=None, max_length=8000)


def _env() -> dict[str, str]:
    s = get_settings()
    return {
        "BUSINESS_AGENT_ENABLED": "true" if s.business_agent_enabled else "",
        "ANTHROPIC_API_KEY": s.anthropic_api_key or "",
        "BUSINESS_AGENT_MODEL": s.business_agent_model or s.anthropic_model,
    }


def _counts(db: Session) -> list[dict[str, Any]]:
    total = db.execute(select(func.count(Member.id))).scalar_one()
    if not total:
        return []
    recent = db.execute(select(func.count(Member.id)).where(Member.created_at >= utcnow() - timedelta(days=30))).scalar_one()
    by_status = db.execute(select(Member.status, func.count(Member.id)).group_by(Member.status)).all()
    by_market = db.execute(select(Member.market_id, func.count(Member.id)).group_by(Member.market_id)).all()
    fmt = lambda rows: ", ".join(f"{k}: {n}" for k, n in rows) or "none"  # noqa: E731
    return [{
        "sourceId": "app:members",
        "title": "Lovera member counts",
        "trusted": True,
        "text": f"Members: {total}. New in the last 30 days: {recent}. By status: {fmt(by_status)}. By market: {fmt(by_market)}.",
    }]


@router.get("")
def charter(principal: Principal = Depends(require_roles("admin"))) -> dict:
    return {"agent": BUSINESS_AGENT, "sharedApprovals": SHARED_APPROVALS, "off": agent_off_reason(_env())}


@router.post("/run")
def run(data: RunIn, principal: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    env = _env()
    off = agent_off_reason(env)
    if off:
        raise ApiError("AI_UNAVAILABLE", off)
    evidence = _counts(db)
    if data.notes:
        evidence.append({"sourceId": "admin:notes", "title": "Notes from the admin", "text": data.notes})
    return run_business_task(BUSINESS_AGENT, data.taskId, evidence, model=provider_from_env(env))
