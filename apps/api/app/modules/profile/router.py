from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.datauri import MAX_DATA_URL_CHARS
from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.models.conversations import Conversation
from app.models.introductions import Introduction
from app.models.profile import ProfileMedia
from app.modules.profile import service

router = APIRouter(tags=["profile"])


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=60)
    pronouns: str | None = Field(default=None, max_length=32)
    occupation: str | None = Field(default=None, max_length=80)
    education: str | None = Field(default=None, max_length=80)
    bio: str | None = Field(default=None, max_length=600)
    languages: list[str] | None = None
    prompts: list[dict[str, Any]] | None = None
    version: int | None = None


class MediaCreate(BaseModel):
    type: str
    content_type: str
    size_bytes: int = 0
    checksum: str | None = None
    alt_text: str | None = None


class MediaComplete(BaseModel):
    checksum: str | None = None
    data_url: str | None = Field(default=None, max_length=MAX_DATA_URL_CHARS)


@router.get("/profile")
def get_profile(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.own_profile_payload(db, principal.member)


@router.patch("/profile")
def patch_profile(data: ProfilePatch, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.update_profile(db, principal.member, data.model_dump(exclude_unset=True))
    from app.modules.account.service import advance_onboarding

    advance_onboarding(db, principal.member)
    return service.own_profile_payload(db, principal.member)


@router.post("/profile/media", status_code=201)
def create_media(data: MediaCreate, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    media = service.create_media(db, principal.member, data.type, data.content_type, data.size_bytes, data.checksum, data.alt_text)
    return {"media": service.media_payload(media), "upload": {"method": "POST", "url": f"/v1/profile/media/{media.id}/complete", "note": "Sandbox upload: post the data URL to the complete endpoint."}}


@router.post("/profile/media/{media_id}/complete")
def complete_media(media_id: str, data: MediaComplete, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    media = service.complete_media(db, principal.member, media_id, data.checksum, data.data_url)
    from app.modules.account.service import advance_onboarding

    advance_onboarding(db, principal.member)
    return service.media_payload(media)


@router.delete("/profile/media/{media_id}", status_code=204)
def delete_media(media_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> None:
    service.delete_media(db, principal.member, media_id)


@router.get("/media/{media_id}")
def get_media(media_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> Response:
    """Media is served only to the owner or to a member with an active introduction or conversation with the owner."""
    media = db.get(ProfileMedia, media_id)
    if media is None or media.deleted_at is not None or media.upload_state != "complete":
        raise ApiError("NOT_FOUND")
    if media.member_id != principal.id:
        from sqlalchemy import or_, select

        intro = db.execute(
            select(Introduction.id).where(
                Introduction.status.in_(("offered", "mutual")),
                or_(
                    (Introduction.member_a_id == principal.id) & (Introduction.member_b_id == media.member_id),
                    (Introduction.member_b_id == principal.id) & (Introduction.member_a_id == media.member_id),
                ),
            )
        ).first()
        conv = db.execute(
            select(Conversation.id).where(
                or_(
                    (Conversation.member_a_id == principal.id) & (Conversation.member_b_id == media.member_id),
                    (Conversation.member_b_id == principal.id) & (Conversation.member_a_id == media.member_id),
                )
            )
        ).first()
        if not intro and not conv and not principal.has_role("admin", "safety_reviewer", "concierge"):
            raise ApiError("NOT_FOUND")
    from app.modules.profile.storage import get_object

    data_url = get_object(media.storage_key)
    if not data_url:
        raise ApiError("NOT_FOUND")
    return Response(content=data_url, media_type="text/plain")
