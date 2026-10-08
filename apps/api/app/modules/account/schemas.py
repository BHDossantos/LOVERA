from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from app.core.timeutil import TimezoneName


class AuthStartIn(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=320)
    invite_code: str | None = None
    locale: str = "en"


class AuthStartOut(BaseModel):
    challenge_id: str
    delivery: str
    dev_code: str | None = None


class AuthVerifyIn(BaseModel):
    challenge_id: str
    code: str = Field(min_length=6, max_length=6)
    device_id: str | None = None


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"


class RefreshIn(BaseModel):
    refresh_token: str
    # Optional so a client that predates this still refreshes. It is what separates a retry of an
    # interrupted refresh from a replay of a token that leaked: see `rotate_session`.
    device_id: str | None = None


class ConsentIn(BaseModel):
    status: str = Field(pattern="^(granted|revoked)$")
    policy_version: str = "2026-09"


class AdultConsentIn(BaseModel):
    birth_date: date
    accept_terms: bool
    accept_privacy: bool
    accept_community: bool
    ai_processing_consent: bool = True
    special_category_consent: bool = False
    terms_version: str = "2026-09"


class MeUpdateIn(BaseModel):
    locale: str | None = Field(default=None, pattern="^(en|it|es|pt)$")
    timezone: TimezoneName | None = None
    date_ready: bool | None = None


class IntentIn(BaseModel):
    intent: str = Field(pattern="^(long_term|life_partner)$")
    home_city_id: str
    home_zone_id: str
    gender: str = Field(pattern="^(woman|man|non_binary|other)$")
    seeking: list[str]
    max_distance_km: int = Field(ge=1, le=200, default=25)
    relocation_openness: str | None = Field(default=None, pattern="^(open|maybe|no)$")


class CapabilitiesOut(BaseModel):
    plan: str
    entitlements: dict[str, Any]
    restrictions: list[str]


class MeOut(BaseModel):
    id: str
    email: str
    status: str
    onboarding_step: str
    locale: str
    timezone: str
    market_id: str
    home_city_id: str | None
    home_zone_id: str | None
    intent: str | None
    gender: str | None
    seeking: list[str]
    max_distance_km: int
    date_ready: bool
    roles: list[str]
    verification_status: str
    blueprint_confirmed: bool
    profile_complete: bool
    availability_set: bool
    capabilities: CapabilitiesOut
    deletion_due_at: str | None
    paused: bool
    created_at: str
