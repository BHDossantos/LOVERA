"""Application settings. Every secret comes from the environment; nothing is committed."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MM_", env_file=".env", extra="ignore")

    env: str = "local"  # local | development | staging | production
    database_url: str = "postgresql+psycopg://postgres@/matchmaker?host=/tmp&port=5433"
    redis_url: str | None = None
    secret_key: str = "local-dev-secret-change-me-before-any-deployment"
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_seconds: int = 60 * 60 * 24 * 30
    cors_origins: list[str] = ["http://localhost:3000"]

    # Market and product policy
    market_id: str = "rome"
    market_timezone: str = "Europe/Rome"
    weekly_intro_cap_free: int = 1
    weekly_intro_cap_paid: int = 3
    introduction_window_hours: int = 48
    introduction_extension_hours: int = 24
    max_active_conversations: int = 3
    max_pending_introductions: int = 3
    blueprint_freshness_days: int = 120
    verification_validity_days: int = 365
    deletion_grace_days: int = 14
    checkin_location_retention_hours: int = 24
    trial_introductions: int = 1

    # Worker schedule (market timezone). The weekly batch runs once per cohort date.
    job_tick_seconds: int = 60
    match_batch_weekday: int = 3  # 0 = Monday … 6 = Sunday
    match_batch_hour: int = 16
    match_auto_publish: bool = False  # concierge review before publishing; local/dev may set true

    # Vendors (sandbox by default; real adapters read their own keys)
    identity_provider: str = "sandbox"  # sandbox | webhook-only vendor
    identity_webhook_secret: str = "sandbox-identity-secret"
    payments_provider: str = "sandbox"  # sandbox | stripe
    payments_webhook_secret: str = "sandbox-payments-secret"
    stripe_api_key: str | None = None

    # AI gateway
    ai_provider: str = "auto"  # auto | anthropic | deterministic | unavailable
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5"
    ai_prompt_version: str = "assistant-2026-09"

    # Dev conveniences
    expose_dev_otp: bool = True  # returns OTP in the auth response outside production
    staff_bootstrap_emails: list[str] = ["concierge@example.test", "safety@example.test", "admin@example.test"]

    @property
    def is_production(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
