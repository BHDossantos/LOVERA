from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.modules.notifications import service

router = APIRouter(prefix="/notifications", tags=["notifications"])


class ReadIn(BaseModel):
    ids: list[str] | None = None


@router.get("")
def list_notifications(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    items = service.list_for(db, principal.id)
    return {"items": items, "unread": len([i for i in items if not i["read_at"]])}


@router.post("/read")
def read(data: ReadIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return {"marked": service.mark_read(db, principal.id, data.ids)}
