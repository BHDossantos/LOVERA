from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.modules.account import schemas, service

router = APIRouter(tags=["account"])


@router.post("/auth/start", response_model=schemas.AuthStartOut)
def auth_start(data: schemas.AuthStartIn, db: Session = Depends(get_db, scope="function")) -> dict:
    settings = get_settings()
    challenge, code = service.start_challenge(db, data.email)
    # Outside production the response carries the code, so a mail host that is absent or
    # broken is only worth logging. In production it is the member's only way in, so a
    # failed send has to fail the request rather than promise an inbox that stays empty.
    expose = settings.expose_dev_otp and not settings.is_production
    delivered = service.deliver_login_code(challenge.email, code, data.locale, required=not expose)
    return {
        "challenge_id": challenge.id,
        "delivery": "email" if delivered else "response",
        "dev_code": code if expose else None,
    }


@router.post("/auth/verify", response_model=schemas.TokenOut)
def auth_verify(data: schemas.AuthVerifyIn, request: Request, db: Session = Depends(get_db, scope="function")) -> dict:
    member, session, access, refresh = service.verify_challenge(db, data.challenge_id, data.code, data.device_id)
    return {"access_token": access, "refresh_token": refresh, "expires_in": get_settings().access_token_ttl_seconds}


@router.post("/auth/refresh", response_model=schemas.TokenOut)
def auth_refresh(data: schemas.RefreshIn, db: Session = Depends(get_db, scope="function")) -> dict:
    _, _, access, refresh = service.rotate_session(db, data.refresh_token)
    return {"access_token": access, "refresh_token": refresh, "expires_in": get_settings().access_token_ttl_seconds}


@router.post("/auth/logout", status_code=204)
def auth_logout(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> None:
    service.revoke_session(db, principal.session_id)


@router.get("/me", response_model=schemas.MeOut)
def get_me(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.me_payload(db, principal.member)


@router.patch("/me", response_model=schemas.MeOut)
def patch_me(data: schemas.MeUpdateIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    m = principal.member
    if data.locale:
        m.locale = data.locale
    if data.timezone:
        m.timezone = data.timezone
    if data.date_ready is not None:
        m.date_ready = data.date_ready
    return service.me_payload(db, m)


@router.post("/me/adult-consent", response_model=schemas.MeOut)
def adult_consent(data: schemas.AdultConsentIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.complete_adult_consent(db, principal.member, data)
    return service.me_payload(db, principal.member)


@router.post("/me/intent", response_model=schemas.MeOut)
def set_intent(data: schemas.IntentIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    if principal.member.birth_date is None:
        raise ApiError("ONBOARDING_INCOMPLETE", "Confirm adult eligibility first.", extra={"onboarding_step": "account"})
    service.set_intent(db, principal.member, data)
    service.advance_onboarding(db, principal.member)
    return service.me_payload(db, principal.member)


@router.post("/me/pause", response_model=schemas.MeOut)
def pause_me(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.pause(db, principal.member)
    return service.me_payload(db, principal.member)


@router.post("/me/resume", response_model=schemas.MeOut)
def resume_me(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.pause(db, principal.member, resume=True)
    return service.me_payload(db, principal.member)


@router.delete("/me", response_model=schemas.MeOut)
def delete_me(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function"), x_reauth_code: str | None = Header(default=None)) -> dict:
    # Re-authentication is represented by a fresh OTP challenge code header; the pilot accepts the session itself when absent.
    service.begin_deletion(db, principal.member)
    return service.me_payload(db, principal.member)


@router.post("/me/cancel-deletion", response_model=schemas.MeOut)
def cancel_delete_me(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.cancel_deletion(db, principal.member)
    return service.me_payload(db, principal.member)


@router.get("/consents")
def list_consents(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return {"purposes": list(service.CONSENT_PURPOSES), "consents": service.current_consents(db, principal.id)}


@router.put("/consents/{purpose}")
def put_consent(purpose: str, data: schemas.ConsentIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    if purpose in ("terms", "privacy", "community") and data.status == "revoked":
        raise ApiError("CONFLICT", "Revoking the terms means deleting the account. Use account deletion instead.")
    service.record_consent(db, principal.member, purpose, data.status, data.policy_version)
    from app.core.analytics import track

    track(db, "data_right_exercised", principal.id, type="consent_change")
    return {"consents": service.current_consents(db, principal.id)}
