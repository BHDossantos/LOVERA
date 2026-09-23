from __future__ import annotations

from fastapi import APIRouter, Depends
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.modules.notifications import service

router = APIRouter(prefix="/notifications", tags=["notifications"])


class ReadIn(BaseModel):
    ids: list[str] | None = None


class PushDeviceIn(BaseModel):
    token: str = Field(min_length=8, max_length=256)
    platform: Literal["ios", "android"]
    device_id: str | None = Field(default=None, max_length=64)
    app_version: str | None = Field(default=None, max_length=32)


class PushRevokeIn(BaseModel):
    token: str | None = Field(default=None, max_length=256)
    device_id: str | None = Field(default=None, max_length=64)


@router.get("")
def list_notifications(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    items = service.list_for(db, principal.id)
    return {"items": items, "unread": len([i for i in items if not i["read_at"]])}


@router.post("/read")
def read(data: ReadIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return {"marked": service.mark_read(db, principal.id, data.ids)}


@router.put("/devices")
def register_device(data: PushDeviceIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    """Register this handset for push. Idempotent on the token so an app that
    re-registers on every launch — which is what the platform guidance asks for —
    does not accumulate rows."""
    return service.register_push_device(db, principal.id, data.token, data.platform, data.device_id, data.app_version)


@router.post("/devices/revoke")
def revoke_device(data: PushRevokeIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return {"revoked": service.revoke_push_device(db, principal.id, data.token, data.device_id)}
