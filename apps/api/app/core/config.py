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
    # sandbox: a simulated capture page, refused in production — see main.check_identity_provider.
    # manual_review: no vendor at all; every member is approved or rejected by a person in the
    #   admin queue. A deliberate pilot posture, not a fallback.
    # anything else: a real vendor, which reports through POST /webhooks/verification.
    identity_provider: str = "sandbox"  # sandbox | manual_review | webhook-only vendor
    identity_webhook_secret: str = "sandbox-identity-secret"
    payments_provider: str = "sandbox"  # sandbox | stripe
    # How a purchase made through an app store is verified before it grants anything.
    #
    #   disabled  — the default. `POST /subscriptions/store-purchase` refuses, and the phone is
    #               told the store is not configured so it shows no purchase UI at all.
    #   sandbox   — the receipt is taken at face value. Refused outright in production, because a
    #               client-asserted receipt is a self-service upgrade to the most expensive tier.
    #   app_store / play_store — verify with the store's own server, in modules/billing/stores.py.
    #               Set the matching credentials below; without them `/plans` reports the store as
    #               off and the phone draws no purchase UI, rather than offering a button that
    #               fails.
    #
    # There is deliberately no value that trusts the client in production. A missing validator has
    # to fail closed: the worst outcome of refusing is that nobody can buy, and the worst outcome
    # of trusting is that everybody gets Concierge for nothing.
    store_validation: str = "disabled"  # disabled | sandbox | app_store | play_store

    # App Store Server API. The issuer id and key id come from App Store Connect → Users and
    # Access → Integrations → App Store Connect API; the private key is the contents of the .p8
    # that page downloads once and never shows again. Three shapes of the key are accepted (PEM,
    # PEM with literal \n, or base64 of the file) because a multi-line secret in an environment
    # variable is where this otherwise quietly breaks.
    app_store_issuer_id: str | None = None
    app_store_key_id: str | None = None
    app_store_private_key: str | None = None
    app_store_bundle_id: str = "com.joinlovera.app"
    # auto asks production and falls back to sandbox on "no such transaction", which is the only
    # way to tell which environment an id belongs to. Pin it to production for a deployment that
    # must never honour a sandbox purchase.
    app_store_environment: str = "auto"  # auto | production | sandbox

    # Google Play Developer API. The JSON key of a service account that has been granted "View
    # app information" and "Release apps to testing tracks" on this app in the Play Console —
    # membership of the developer account alone is not enough. JSON or base64 of it.
    play_service_account_json: str | None = None
    play_package_name: str = "com.joinlovera.app"
    payments_webhook_secret: str = "sandbox-payments-secret"
    stripe_api_key: str | None = None

    # Outbound email. Any provider that speaks SMTP works; none of this is vendor-specific.
    # transport: auto picks smtp when a host is set and console when it is not. See core/mail.py.
    mail_transport: str = "auto"  # auto | smtp | console
    mail_product_name: str = "Lovera"
    mail_from: str = "Lovera <no-reply@localhost>"
    mail_reply_to: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_security: str = "starttls"  # starttls | ssl | none
    smtp_timeout_seconds: int = 10

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

    @property
    def resolved_mail_transport(self) -> str:
        """The transport that will actually be used, with "auto" settled."""
        if self.mail_transport != "auto":
            return self.mail_transport
        return "smtp" if self.smtp_host else "console"


@lru_cache
def get_settings() -> Settings:
    return Settings()
