from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.audit import audit
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import create_access_token, hash_secret, new_opaque_token, new_otp
from app.core.timeutil import iso, utcnow
from app.models.account import AuthChallenge, ConsentRecord, Member
from app.models.account import Session as MemberSession
from app.models.availability import AvailabilityVersion
from app.models.blueprint import BlueprintVersion
from app.models.profile import Profile
from app.models.safety import SafetyAction
from app.models.verification import Verification

CONSENT_PURPOSES = ("terms", "privacy", "community", "ai_processing", "special_category", "model_improvement", "marketing")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def start_challenge(db: Session, email: str) -> tuple[AuthChallenge, str]:
    code = new_otp()
    challenge = AuthChallenge(email=normalize_email(email), code_hash=hash_secret(code), expires_at=utcnow() + timedelta(minutes=10))
    db.add(challenge)
    db.flush()
    return challenge, code


def verify_challenge(db: Session, challenge_id: str, code: str, device_id: str | None, invite_code: str | None = None, locale: str = "en") -> tuple[Member, MemberSession, str, str]:
    challenge = db.get(AuthChallenge, challenge_id)
    if challenge is None or challenge.consumed_at is not None or challenge.expires_at <= utcnow():
        raise ApiError("AUTH_REQUIRED", "That code has expired. Request a new one.")
    challenge.attempts += 1
    if challenge.attempts > 5:
        raise ApiError("RATE_LIMITED", "Too many attempts. Request a new code.", retry_after=60)
    if challenge.code_hash != hash_secret(code):
        raise ApiError("VALIDATION_ERROR", "That code is not right.", field_errors={"code": "incorrect"})
    challenge.consumed_at = utcnow()
    member = db.execute(select(Member).where(Member.email == challenge.email)).scalar_one_or_none()
    settings = get_settings()
    created = False
    if member is None:
        roles = ["member"]
        if challenge.email in settings.staff_bootstrap_emails:
            role = challenge.email.split("@")[0]
            roles.append({"concierge": "concierge", "safety": "safety_reviewer", "admin": "admin"}.get(role, "support"))
        member = Member(
            email=challenge.email,
            email_hash=hashlib.sha256(challenge.email.encode()).hexdigest(),
            locale=locale if locale in ("en", "it", "es", "pt") else "en",
            market_id=settings.market_id,
            timezone=settings.market_timezone,
            roles=roles,
            invite_code=invite_code,
        )
        db.add(member)
        db.flush()
        db.add(Profile(member_id=member.id))
        created = True
        track(db, "account_created", member.id, locale=member.locale, market=member.market_id, acquisition_channel="invite" if invite_code else "direct")
    if member.status == "deleted":
        raise ApiError("AUTH_REQUIRED", "This account was deleted.")
    session, refresh = create_session(db, member, device_id)
    access = create_access_token(member.id, session.id, list(member.roles or ["member"]))
    audit(db, actor_type="member", actor_id=member.id, action="auth.signed_in" if not created else "auth.account_created", resource_type="member", resource_id=member.id)
    return member, session, access, refresh


def create_session(db: Session, member: Member, device_id: str | None) -> tuple[MemberSession, str]:
    settings = get_settings()
    refresh = new_opaque_token()
    session = MemberSession(
        member_id=member.id,
        device_id_hash=hash_secret(device_id) if device_id else None,
        refresh_token_hash=hash_secret(refresh),
        expires_at=utcnow() + timedelta(seconds=settings.refresh_token_ttl_seconds),
        last_seen_at=utcnow(),
    )
    db.add(session)
    db.flush()
    return session, refresh


def rotate_session(db: Session, refresh_token: str) -> tuple[Member, MemberSession, str, str]:
    session = db.execute(select(MemberSession).where(MemberSession.refresh_token_hash == hash_secret(refresh_token))).scalar_one_or_none()
    if session is None or session.revoked_at is not None or session.expires_at <= utcnow():
        raise ApiError("AUTH_REQUIRED", "Session expired. Sign in again.")
    member = db.get(Member, session.member_id)
    if member is None or member.status == "deleted":
        raise ApiError("AUTH_REQUIRED")
    session.revoked_at = utcnow()
    new_session, refresh = create_session(db, member, None)
    new_session.device_id_hash = session.device_id_hash
    access = create_access_token(member.id, new_session.id, list(member.roles or ["member"]))
    return member, new_session, access, refresh


def revoke_session(db: Session, session_id: str) -> None:
    session = db.get(MemberSession, session_id)
    if session and session.revoked_at is None:
        session.revoked_at = utcnow()


def record_consent(db: Session, member: Member, purpose: str, status: str, policy_version: str, source: str = "app") -> ConsentRecord:
    if purpose not in CONSENT_PURPOSES:
        raise ApiError("VALIDATION_ERROR", "Unknown consent purpose.", field_errors={"purpose": "unknown"})
    proof = hashlib.sha256(f"{member.id}:{purpose}:{policy_version}:{status}:{utcnow().isoformat()}".encode()).hexdigest()
    record = ConsentRecord(
        member_id=member.id,
        purpose=purpose,
        policy_version=policy_version,
        status=status,
        granted_at=utcnow() if status == "granted" else None,
        revoked_at=utcnow() if status == "revoked" else None,
        source=source,
        proof_hash=proof,
    )
    db.add(record)
    audit(db, actor_type="member", actor_id=member.id, action=f"consent.{status}", resource_type="consent", resource_id=purpose, metadata={"policy_version": policy_version})
    return record


def current_consents(db: Session, member_id: str) -> dict[str, dict[str, Any]]:
    rows = db.execute(select(ConsentRecord).where(ConsentRecord.member_id == member_id).order_by(ConsentRecord.created_at)).scalars().all()
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        out[r.purpose] = {"status": r.status, "policy_version": r.policy_version, "changed_at": iso(r.granted_at or r.revoked_at)}
    return out


def has_consent(db: Session, member_id: str, purpose: str) -> bool:
    return current_consents(db, member_id).get(purpose, {}).get("status") == "granted"


def age_on(birth: date, today: date) -> int:
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def complete_adult_consent(db: Session, member: Member, data: Any) -> Member:
    today = utcnow().date()
    if age_on(data.birth_date, today) < 18:
        audit(db, actor_type="member", actor_id=member.id, action="consent.under_18_blocked", resource_type="member", resource_id=member.id)
        raise ApiError("FORBIDDEN", "This service is for adults only.", extra={"reason": "under_18"})
    if not (data.accept_terms and data.accept_privacy and data.accept_community):
        raise ApiError("VALIDATION_ERROR", "Terms, privacy notice and community agreement are required.")
    member.birth_date = data.birth_date
    for purpose, ok in (("terms", data.accept_terms), ("privacy", data.accept_privacy), ("community", data.accept_community), ("ai_processing", data.ai_processing_consent), ("special_category", data.special_category_consent)):
        record_consent(db, member, purpose, "granted" if ok else "revoked", data.terms_version)
    if member.status == "pending_consent":
        member.status = "pending_verification"
        member.onboarding_step = "verification"
    member.row_version += 1
    return member


def latest_verification(db: Session, member_id: str) -> Verification | None:
    return db.execute(select(Verification).where(Verification.member_id == member_id).order_by(Verification.created_at.desc()).limit(1)).scalar_one_or_none()


def verification_status(db: Session, member_id: str) -> str:
    v = latest_verification(db, member_id)
    if v is None:
        return "not_started"
    if v.status == "verified" and v.expires_at and v.expires_at <= utcnow():
        return "expired"
    return v.status


def is_verified(db: Session, member_id: str) -> bool:
    return verification_status(db, member_id) == "verified"


def confirmed_blueprint(db: Session, member_id: str) -> BlueprintVersion | None:
    return db.execute(select(BlueprintVersion).where(BlueprintVersion.member_id == member_id, BlueprintVersion.status == "confirmed")).scalar_one_or_none()


def active_restrictions(db: Session, member_id: str) -> list[SafetyAction]:
    now = utcnow()
    rows = db.execute(select(SafetyAction).where(SafetyAction.subject_id == member_id, SafetyAction.lifted_at.is_(None))).scalars().all()
    return [r for r in rows if r.active(now)]


def capabilities(db: Session, member: Member) -> dict[str, Any]:
    from app.modules.billing.service import entitlements_for  # local import: billing owns plans

    ent = entitlements_for(db, member)
    restrictions = [a.type for a in active_restrictions(db, member.id)]
    if member.status == "paused":
        restrictions.append("paused")
    return {"plan": ent["plan"], "entitlements": ent, "restrictions": restrictions}


def me_payload(db: Session, member: Member) -> dict[str, Any]:
    profile = db.get(Profile, member.id)
    availability = db.execute(select(AvailabilityVersion.id).where(AvailabilityVersion.member_id == member.id).limit(1)).scalar()
    return {
        "id": member.id,
        "email": member.email,
        "status": member.status,
        "onboarding_step": member.onboarding_step,
        "locale": member.locale,
        "timezone": member.timezone,
        "market_id": member.market_id,
        "home_city_id": member.home_city_id,
        "home_zone_id": member.home_zone_id,
        "intent": member.intent,
        "gender": member.gender,
        "seeking": list(member.seeking or []),
        "max_distance_km": member.max_distance_km,
        "date_ready": member.date_ready,
        "roles": list(member.roles or ["member"]),
        "verification_status": verification_status(db, member.id),
        "blueprint_confirmed": confirmed_blueprint(db, member.id) is not None,
        "profile_complete": bool(profile and profile.completeness >= 60),
        "availability_set": availability is not None,
        "capabilities": capabilities(db, member),
        "deletion_due_at": iso(member.deletion_due_at),
        "paused": member.status == "paused",
        "created_at": iso(member.created_at) or "",
    }


def set_intent(db: Session, member: Member, data: Any) -> Member:
    from app.catalog.cities import CITIES, ZONES

    if data.home_city_id not in CITIES:
        raise ApiError("VALIDATION_ERROR", "Unknown city.", field_errors={"home_city_id": "unknown"})
    zone = ZONES.get(data.home_zone_id)
    if zone is None or zone.city_id != data.home_city_id:
        raise ApiError("VALIDATION_ERROR", "Choose a zone within your city.", field_errors={"home_zone_id": "unknown"})
    if not data.seeking:
        raise ApiError("VALIDATION_ERROR", "Tell us who you would like to meet.", field_errors={"seeking": "required"})
    member.intent = data.intent
    member.home_city_id = data.home_city_id
    member.home_zone_id = data.home_zone_id
    member.market_id = data.home_city_id
    member.timezone = CITIES[data.home_city_id].timezone
    member.gender = data.gender
    member.seeking = sorted(set(data.seeking))
    member.max_distance_km = data.max_distance_km
    member.relocation_openness = data.relocation_openness
    if member.onboarding_step in ("verification", "intent") and is_verified(db, member.id):
        member.onboarding_step = "blueprint"
        member.status = "onboarding"
    member.row_version += 1
    return member


def advance_onboarding(db: Session, member: Member) -> None:
    """Recompute the first incomplete onboarding step and activate the member when everything is done."""
    if member.status in ("restricted", "deleted", "deletion_pending", "paused"):
        return
    if member.birth_date is None or not has_consent(db, member.id, "terms"):
        member.status, member.onboarding_step = "pending_consent", "account"
        return
    if not is_verified(db, member.id):
        member.status, member.onboarding_step = "pending_verification", "verification"
        return
    if not member.intent or not member.home_zone_id:
        member.status, member.onboarding_step = "onboarding", "intent"
        return
    if confirmed_blueprint(db, member.id) is None:
        member.status, member.onboarding_step = "onboarding", "blueprint"
        return
    profile = db.get(Profile, member.id)
    if not profile or profile.completeness < 60:
        member.status, member.onboarding_step = "onboarding", "profile"
        return
    availability = db.execute(select(AvailabilityVersion.id).where(AvailabilityVersion.member_id == member.id).limit(1)).scalar()
    if availability is None:
        member.status, member.onboarding_step = "onboarding", "availability"
        return
    member.status, member.onboarding_step = "active", "done"


def pause(db: Session, member: Member, resume: bool = False) -> Member:
    if resume:
        if member.status == "paused":
            member.status = "active"
            member.paused_at = None
    else:
        if member.status != "active":
            raise ApiError("CONFLICT", "Only active members can pause.")
        member.status = "paused"
        member.paused_at = utcnow()
    audit(db, actor_type="member", actor_id=member.id, action="account.resume" if resume else "account.pause", resource_type="member", resource_id=member.id)
    track(db, "data_right_exercised", member.id, type="resume" if resume else "pause")
    return member


def begin_deletion(db: Session, member: Member) -> Member:
    settings = get_settings()
    member.status = "deletion_pending"
    member.deletion_due_at = utcnow() + timedelta(days=settings.deletion_grace_days)
    for s in db.execute(select(MemberSession).where(MemberSession.member_id == member.id, MemberSession.revoked_at.is_(None))).scalars():
        pass  # current session stays valid so the member can cancel; other devices are not force-revoked in the pilot
    audit(db, actor_type="member", actor_id=member.id, action="account.deletion_requested", resource_type="member", resource_id=member.id)
    track(db, "data_right_exercised", member.id, type="delete")
    return member


def cancel_deletion(db: Session, member: Member) -> Member:
    if member.status != "deletion_pending":
        raise ApiError("CONFLICT", "No deletion is pending.")
    member.status = "active"
    member.deletion_due_at = None
    advance_onboarding(db, member)
    audit(db, actor_type="member", actor_id=member.id, action="account.deletion_cancelled", resource_type="member", resource_id=member.id)
    return member
