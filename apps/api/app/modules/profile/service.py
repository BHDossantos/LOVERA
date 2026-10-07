from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog.cities import CITIES, ZONES, distance_band, zone_distance_km
from app.catalog.prompts import PROFILE_PROMPTS
from app.core.analytics import track
from app.core.audit import audit
from app.core.datauri import AUDIO_TYPES, IMAGE_TYPES, decode_data_url
from app.core.errors import ApiError
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.profile import Profile, ProfileMedia

VISIBILITY = {
    "display_name": "public",
    "age": "public",
    "city": "public",
    "distance_band": "public",
    "verification": "public",
    "intent": "public",
    "languages": "public",
    "prompts": "public",
    "bio": "public",
    "occupation": "public",
    "pronouns": "public",
    "photos": "public",
    "voice": "public",
    "zone": "matching_only",
    "birth_date": "private",
    "email": "private",
    "gender_and_seeking": "matching_only",
    "blueprint_signals": "matching_only",
    "preferences": "matching_only",
    "availability": "matching_only",
    "post_date_feedback": "matching_only_private",
    "safety_reports": "safety_only",
    "identity_documents": "never_stored",
}


def compute_completeness(profile: Profile, media: list[ProfileMedia]) -> int:
    score = 0
    if profile.display_name:
        score += 20
    if profile.bio and len(profile.bio) >= 40:
        score += 15
    if profile.languages:
        score += 10
    if len([p for p in (profile.prompts or []) if p.get("answer")]) >= 2:
        score += 20
    photos = [m for m in media if m.type == "photo" and m.deleted_at is None and m.moderation_status == "approved"]
    if photos:
        score += 25
    if any(m.type == "voice" and m.deleted_at is None for m in media):
        score += 10
    return min(score, 100)


def media_for(db: Session, member_id: str) -> list[ProfileMedia]:
    return db.execute(select(ProfileMedia).where(ProfileMedia.member_id == member_id, ProfileMedia.deleted_at.is_(None)).order_by(ProfileMedia.position)).scalars().all()


def media_payload(m: ProfileMedia) -> dict[str, Any]:
    return {"id": m.id, "type": m.type, "position": m.position, "alt_text": m.alt_text, "moderation_status": m.moderation_status, "upload_state": m.upload_state, "url": f"/v1/media/{m.id}" if m.upload_state == "complete" else None}


def own_profile_payload(db: Session, member: Member) -> dict[str, Any]:
    profile = db.get(Profile, member.id)
    media = media_for(db, member.id)
    profile.completeness = compute_completeness(profile, media)
    return {
        "member_id": member.id,
        "display_name": profile.display_name,
        "pronouns": profile.pronouns,
        "occupation": profile.occupation,
        "education": profile.education,
        "bio": profile.bio,
        "languages": profile.languages,
        "prompts": profile.prompts,
        "available_prompts": [{"key": k, "label": label} for k, label in PROFILE_PROMPTS],
        "intent": member.intent,
        "city": CITIES[member.home_city_id].name if member.home_city_id in CITIES else None,
        "zone": ZONES[member.home_zone_id].name if member.home_zone_id in ZONES else None,
        "age": _age(member),
        "media": [media_payload(m) for m in media],
        "moderation_status": profile.moderation_status,
        "completeness": profile.completeness,
        "visibility_map": VISIBILITY,
        "version": profile.version,
        "updated_at": iso(profile.updated_at),
    }


def _age(member: Member) -> int | None:
    if not member.birth_date:
        return None
    from app.modules.account.service import age_on

    return age_on(member.birth_date, utcnow().date())


def snapshot_for_viewer(db: Session, subject: Member, viewer: Member) -> dict[str, Any]:
    """The public snapshot another member sees through an authorized introduction or conversation."""
    from app.modules.account.service import verification_status

    profile = db.get(Profile, subject.id)
    media = [m for m in media_for(db, subject.id) if m.moderation_status == "approved" and m.upload_state == "complete"]
    km = zone_distance_km(subject.home_zone_id, viewer.home_zone_id)
    return {
        "member_id": subject.id,
        "display_name": profile.display_name or "Member",
        "pronouns": profile.pronouns,
        "age": _age(subject),
        "city": CITIES[subject.home_city_id].name if subject.home_city_id in CITIES else None,
        "distance_band_km": distance_band(km),
        "verified": verification_status(db, subject.id) == "verified",
        "intent": subject.intent,
        "languages": profile.languages,
        "occupation": profile.occupation,
        "bio": profile.bio,
        "prompts": [p for p in (profile.prompts or []) if p.get("answer")],
        "media": [media_payload(m) for m in media],
    }


def update_profile(db: Session, member: Member, data: dict[str, Any]) -> Profile:
    profile = db.get(Profile, member.id)
    if data.get("version") is not None and data["version"] != profile.version:
        raise ApiError("VERSION_MISMATCH", "Your profile changed elsewhere. Reload and try again.")
    for field in ("display_name", "pronouns", "occupation", "education", "bio"):
        if field in data and data[field] is not None:
            setattr(profile, field, data[field].strip()[:600] if isinstance(data[field], str) else data[field])
    if data.get("languages") is not None:
        profile.languages = [l for l in data["languages"] if l in ("en", "it", "es", "pt", "fr", "de", "ca", "other")]
    if data.get("prompts") is not None:
        allowed = {k for k, _ in PROFILE_PROMPTS}
        profile.prompts = [{"key": p["key"], "answer": str(p.get("answer", ""))[:240]} for p in data["prompts"] if p.get("key") in allowed][:3]
    profile.version += 1
    profile.updated_at = utcnow()
    profile.moderation_status = "approved"  # text moderation hook: the pilot uses human spot checks via the admin console
    profile.completeness = compute_completeness(profile, media_for(db, member.id))
    if profile.completeness >= 60:
        track(db, "profile_completed", member.id, completion_categories=["name", "bio", "prompts"])
    audit(db, actor_type="member", actor_id=member.id, action="profile.updated", resource_type="profile", resource_id=member.id)
    return profile


def create_media(db: Session, member: Member, media_type: str, content_type: str, size_bytes: int, checksum: str | None, alt_text: str | None) -> ProfileMedia:
    if media_type not in ("photo", "voice"):
        raise ApiError("VALIDATION_ERROR", "Unsupported media type.", field_errors={"type": "photo or voice"})
    if size_bytes > 15 * 1024 * 1024:
        raise ApiError("VALIDATION_ERROR", "File is too large (max 15 MB).", field_errors={"size_bytes": "too_large"})
    existing = media_for(db, member.id)
    if media_type == "photo" and len([m for m in existing if m.type == "photo"]) >= 6:
        raise ApiError("CONFLICT", "You can have up to six photos.")
    position = max([m.position for m in existing], default=-1) + 1
    media = ProfileMedia(member_id=member.id, type=media_type, storage_key=f"profile/{member.id}/{hashlib.sha256((checksum or str(position)).encode()).hexdigest()[:24]}", content_type=content_type, size_bytes=size_bytes, checksum=checksum, position=position, alt_text=alt_text, upload_state="created", moderation_status="pending")
    db.add(media)
    db.flush()
    return media


def complete_media(db: Session, member: Member, media_id: str, checksum: str | None, data_url: str | None) -> ProfileMedia:
    media = db.get(ProfileMedia, media_id)
    if media is None or media.member_id != member.id or media.deleted_at is not None:
        raise ApiError("NOT_FOUND")
    if checksum and media.checksum and checksum != media.checksum:
        raise ApiError("VALIDATION_ERROR", "Checksum mismatch. Upload again.", field_errors={"checksum": "mismatch"})
    # The same validation as safety evidence, and for the same reason from the other side: this
    # media is served to other members as an image or audio source, so an unchecked string here is
    # a URL one member can make another member's browser fetch — see app/core/datauri.py.
    if data_url:
        decode_data_url(data_url, media.content_type, AUDIO_TYPES if media.type == "voice" else IMAGE_TYPES)
    media.upload_state = "complete"
    # Pilot storage: small data URLs are kept in the local object store adapter; a real deployment uses signed bucket uploads.
    from app.modules.profile.storage import put_object

    if data_url:
        put_object(media.storage_key, data_url)
    # Moderation: photos are auto-approved in the sandbox and spot-checked by staff; rejected media never publish.
    media.moderation_status = "approved"
    profile = db.get(Profile, member.id)
    profile.completeness = compute_completeness(profile, media_for(db, member.id))
    audit(db, actor_type="member", actor_id=member.id, action="media.completed", resource_type="profile_media", resource_id=media.id, metadata={"type": media.type})
    return media


def delete_media(db: Session, member: Member, media_id: str) -> None:
    media = db.get(ProfileMedia, media_id)
    if media is None or media.member_id != member.id:
        raise ApiError("NOT_FOUND")
    media.deleted_at = utcnow()
    if db.get(Profile, member.id).voice_media_id == media.id:
        db.get(Profile, member.id).voice_media_id = None
    audit(db, actor_type="member", actor_id=member.id, action="media.deleted", resource_type="profile_media", resource_id=media.id)
