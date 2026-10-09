from __future__ import annotations

import hashlib
import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.audit import audit
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.mail import MailError
from app.core.mail import send as send_mail
from app.core.security import create_access_token, hash_secret, new_opaque_token, new_otp
from app.core.sessions import lineage_of, revoke_chain, session_is_live
from app.core.timeutil import iso, utcnow
from app.models.account import AuthChallenge, ConsentRecord, Member
from app.models.account import Session as MemberSession
from app.models.account import SessionLineage
from app.models.availability import AvailabilityVersion
from app.models.blueprint import BlueprintVersion
from app.models.profile import Profile
from app.models.safety import SafetyAction
from app.models.verification import Verification
from app.modules.account.mail import login_code_message

CONSENT_PURPOSES = ("terms", "privacy", "community", "ai_processing", "special_category", "model_improvement", "marketing")


def normalize_email(email: str) -> str:
    return email.strip().lower()


log = logging.getLogger("account")

MAX_CHALLENGES_PER_WINDOW = 5
# The email quotes this, so both must read it from here or the two will drift apart.
CHALLENGE_TTL_MINUTES = 10


def start_challenge(db: Session, email: str) -> tuple[AuthChallenge, str]:
    from sqlalchemy import func

    recent = db.execute(select(func.count(AuthChallenge.id)).where(AuthChallenge.email == normalize_email(email), AuthChallenge.created_at >= utcnow() - timedelta(minutes=10))).scalar() or 0
    if recent >= MAX_CHALLENGES_PER_WINDOW:
        raise ApiError("RATE_LIMITED", "Too many codes requested. Try again in a few minutes.", retry_after=600)
    code = new_otp()
    challenge = AuthChallenge(email=normalize_email(email), code_hash=hash_secret(code), expires_at=utcnow() + timedelta(minutes=CHALLENGE_TTL_MINUTES))
    db.add(challenge)
    db.flush()
    return challenge, code


def deliver_login_code(email: str, code: str, locale: str = "en", *, required: bool = True) -> bool:
    """Mail the sign-in code. Returns whether it reached a real mail host.

    `required=False` is for the local and CI setup, where the code also comes back in
    the response body: a mail host that is missing or misconfigured there is a nuisance
    to log, not a reason to fail the request. In production the response carries no
    code, so a send that fails leaves the member with no way in at all — far better to
    tell them the service is unavailable and let them retry than to show "check your
    inbox" for a mail that was never sent.
    """
    settings = get_settings()
    message = login_code_message(
        to=email,
        code=code,
        product=settings.mail_product_name,
        minutes=CHALLENGE_TTL_MINUTES,
        locale=locale,
    )
    try:
        send_mail(message)
    except MailError as exc:
        # Never log `code`: this branch runs in production, where the log is not the inbox.
        log.error("login code for %s was not sent: %s", email, exc)
        if required:
            raise ApiError(
                "DEPENDENCY_UNAVAILABLE",
                "We could not send the code just now. Try again in a moment.",
                retryable=True,
                retry_after=30,
            ) from exc
        return False
    return settings.resolved_mail_transport != "console"


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


def create_session(db: Session, member: Member, device_id: str | None, parent: MemberSession | None = None) -> tuple[MemberSession, str]:
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
    # A sign-in starts its own chain; a rotation continues the one it came from, which is what makes
    # a replayed token revocable across every session descended from the same sign-in.
    chain = lineage_of(db, parent).chain_id if parent is not None else session.id
    db.add(SessionLineage(session_id=session.id, chain_id=chain, parent_id=parent.id if parent else None))
    db.flush()
    return session, refresh


def _another_device(session: MemberSession, device_id: str | None) -> bool:
    """Whether this request cannot be coming from the client the session was issued to.

    False when the session carries no device binding: there is nothing to compare, and escalating
    to "revoke the whole sign-in" on a guess is worse than refusing the one request.
    """
    if not session.device_id_hash:
        return False
    return hash_secret(device_id or "") != session.device_id_hash


def rotate_session(db: Session, refresh_token: str, device_id: str | None = None) -> tuple[Member, MemberSession, str, str]:
    """Exchange a refresh token for the next one, and treat a genuinely spent token as a theft.

    Rotation used to retire the presented token immediately, which is the textbook single-use rule
    and cost members their session for no reason: the server commits before the client can store the
    reply, so a page reload or an app cold start inside that round trip left the client holding a dead
    token. Handing a replayed token its replacement was tried and reverted — it gives whoever holds a
    copy the live session.

    So the presented token is *superseded* rather than revoked, and stays usable for the moment it
    takes the client to store what came back (see `session_is_live`). A retry inside that moment gets a
    fresh replacement, not a second copy of the same one. Past it, or once the replacement has been
    used, the token is retired for good — and a retired token coming back means two parties have held
    it, so every session descended from that sign-in is revoked at once. That is the OAuth 2.0 Security
    BCP answer (§4.13.2), and the member re-authenticates with a one-time code.

    That leaves one window the overlap opens up and the old rule did not have: between a rotation and
    the client using its replacement, the superseded token still works, so a thief holding a copy could
    spend it while the real client is the one that is absent. `device_id` closes it. The session
    already carries the hash of the device it was issued to, both clients send it, and it is not
    carried inside the token — so a token that leaks on its own (a log line, a crash dump, a backup)
    does not bring it along. A refresh whose device does not match the session's is not a retry by
    anybody, so it is treated as the replay it is. It is a sender constraint, not proof of possession,
    and a thief who has the device id as well as the token still gets through; the claim is only that a
    leaked token is no longer sufficient on its own.
    """
    session = db.execute(select(MemberSession).where(MemberSession.refresh_token_hash == hash_secret(refresh_token))).scalar_one_or_none()
    if session is None:
        raise ApiError("AUTH_REQUIRED", "Session expired. Sign in again.")

    if not session_is_live(db, session):
        # Retired, not merely unknown: this exact token was issued to somebody, and it has come back.
        #
        # Whether that is a theft or a straggler depends on where from. Two browser tabs share one
        # refresh token in localStorage while the single-flight refresh in apps/web/src/lib/api.ts is
        # per tab, so two tabs whose access tokens expire together both refresh with the same token;
        # the quicker one rotates and uses what it got, and then the slower one's request lands with a
        # token that is now spent. Revoking the chain there signs out the tab that did nothing wrong —
        # which the single-use rule never did, so it would be this change making things worse.
        #
        # Chain revocation answers "two parties hold this". It is the wrong answer to "one party holds
        # this twice", and the device the session was issued to is what separates them.
        if session.expires_at > utcnow() and _another_device(session, device_id):
            row = lineage_of(db, session)
            revoked = revoke_chain(db, row.chain_id)
            audit(
                db,
                actor_type="member",
                actor_id=session.member_id,
                action="auth.refresh_replayed",
                resource_type="session",
                resource_id=session.id,
                metadata={"chain_id": row.chain_id, "sessions_revoked": revoked},
            )
            log.warning("refresh token replayed; revoked %s session(s) in chain %s", revoked, row.chain_id)
            # The refusal is an exception, and `get_db` rolls the transaction back on one — so without
            # committing here the revocation and its audit row are discarded and the "response" to a
            # detected replay is nothing at all. Found by the test asserting the chain was down; the
            # UPDATE had run and the log line printed, and the next request still succeeded.
            db.commit()
        raise ApiError("AUTH_REQUIRED", "Session expired. Sign in again.")

    member = db.get(Member, session.member_id)
    if member is None or member.status == "deleted":
        raise ApiError("AUTH_REQUIRED")

    row = lineage_of(db, session)
    if row.successor_id:
        # Still live but already rotated once, so the client never received that reply. Only the device
        # the session was issued to may retry: anybody else presenting a token that has already been
        # spent is replaying it, whatever the grace period says.
        if _another_device(session, device_id):
            revoked = revoke_chain(db, row.chain_id)
            audit(
                db,
                actor_type="member",
                actor_id=session.member_id,
                action="auth.refresh_replayed",
                resource_type="session",
                resource_id=session.id,
                metadata={"chain_id": row.chain_id, "sessions_revoked": revoked, "reason": "device_mismatch"},
            )
            log.warning("spent refresh token presented from another device; revoked %s session(s) in chain %s", revoked, row.chain_id)
            # The refusal is an exception, and `get_db` rolls the transaction back on one — so without
            # committing here the revocation and its audit row are discarded and the "response" to a
            # detected replay is nothing at all. Found by the test asserting the chain was down; the
            # UPDATE had run and the log line printed, and the next request still succeeded.
            db.commit()
            raise ApiError("AUTH_REQUIRED", "Session expired. Sign in again.")
        # Retire the replacement nobody has rather than re-serving it: re-serving is what makes a
        # replay indistinguishable from a retry, and it is the thing that cannot be allowed.
        stale = db.get(MemberSession, row.successor_id)
        if stale is not None and stale.revoked_at is None:
            stale.revoked_at = utcnow()

    new_session, refresh = create_session(db, member, None, parent=session)
    # The chain keeps the device it was issued to, so the check above still has something to compare.
    new_session.device_id_hash = session.device_id_hash
    row.superseded_at, row.successor_id = utcnow(), new_session.id
    access = create_access_token(member.id, new_session.id, list(member.roles or ["member"]))
    return member, new_session, access, refresh


def revoke_session(db: Session, session_id: str) -> None:
    """Sign out. This ends the sign-in, not just the current link in its chain.

    Revoking only this session would leave the one it was rotated from alive for the rest of its grace
    period, and that session's refresh token is one a client may still be holding — so "sign me out"
    would not have signed them out.
    """
    session = db.get(MemberSession, session_id)
    if session is None:
        return
    row = db.get(SessionLineage, session.id)
    revoke_chain(db, row.chain_id if row is not None else session.id)


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
