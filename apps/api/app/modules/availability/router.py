from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.core.timeutil import iso
from app.models.availability import AvailabilityVersion

router = APIRouter(tags=["availability"])
DATE_STYLES = ("coffee", "walk", "drinks", "dinner", "culture", "activity")


class Window(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")


class AvailabilityIn(BaseModel):
    timezone: str | None = None
    recurring_windows: list[Window]
    dated_exceptions: list[dict[str, Any]] = []
    date_styles: list[str] = []
    date_ready: bool = True


def current(db: Session, member_id: str) -> AvailabilityVersion | None:
    return db.execute(select(AvailabilityVersion).where(AvailabilityVersion.member_id == member_id).order_by(AvailabilityVersion.created_at.desc())).scalars().first()


def payload(v: AvailabilityVersion | None, date_ready: bool) -> dict:
    if v is None:
        return {"timezone": None, "recurring_windows": [], "dated_exceptions": [], "date_styles": [], "calendar_source": None, "date_ready": date_ready, "updated_at": None, "policy": "Only coarse free/busy windows are used. Event titles and attendees are never collected."}
    return {"timezone": v.timezone, "recurring_windows": v.recurring_windows, "dated_exceptions": v.dated_exceptions, "date_styles": v.date_styles, "calendar_source": v.calendar_source, "date_ready": date_ready, "updated_at": iso(v.created_at), "policy": "Only coarse free/busy windows are used. Event titles and attendees are never collected."}


@router.get("/availability")
def get_availability(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return payload(current(db, principal.id), principal.member.date_ready)


@router.put("/availability")
def put_availability(data: AvailabilityIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    if not data.recurring_windows:
        raise ApiError("VALIDATION_ERROR", "Add at least one window when you could meet.", field_errors={"recurring_windows": "required"})
    for w in data.recurring_windows:
        if w.start >= w.end:
            raise ApiError("VALIDATION_ERROR", "A window must end after it starts.", field_errors={"recurring_windows": "invalid"})
    styles = [s for s in data.date_styles if s in DATE_STYLES]
    v = AvailabilityVersion(member_id=principal.id, timezone=data.timezone or principal.member.timezone, recurring_windows=[w.model_dump() for w in data.recurring_windows], dated_exceptions=data.dated_exceptions[:30], date_styles=styles)
    db.add(v)
    db.flush()
    principal.member.date_ready = data.date_ready
    track(db, "availability_updated", principal.id, window_count=len(data.recurring_windows), calendar_connected=False)
    from app.modules.account.service import advance_onboarding

    advance_onboarding(db, principal.member)
    return payload(v, principal.member.date_ready)


@router.post("/calendar/connect")
def calendar_connect(principal: Principal = Depends(current_principal)) -> dict:
    return {"status": "not_available_in_pilot", "message": "Calendar free/busy connection arrives after the pilot. Your recurring windows are used instead."}
