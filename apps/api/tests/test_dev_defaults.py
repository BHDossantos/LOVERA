"""A deployment that sets nothing must not hand out sign-in codes or staff roles.

MM_ENV defaults to "local", so an API started without it (a new host, a forgotten env var)
used to run with both dev conveniences on: the sign-in code came back in the response to
whoever asked, and signing in as admin@example.test made an admin. Together that is a full
takeover of any account. Both now default to off and only local setups turn them on.
"""
from __future__ import annotations

from app.core.config import Settings


def test_unconfigured_deploy_keeps_codes_and_staff_roles_closed(monkeypatch):
    monkeypatch.delenv("MM_EXPOSE_DEV_OTP", raising=False)
    monkeypatch.delenv("MM_STAFF_BOOTSTRAP_EMAILS", raising=False)
    monkeypatch.delenv("MM_ENV", raising=False)
    settings = Settings(_env_file=None)
    assert settings.env == "local"
    assert settings.expose_dev_otp is False
    assert settings.staff_bootstrap_emails == []


def test_local_setup_can_still_opt_in(monkeypatch):
    monkeypatch.setenv("MM_EXPOSE_DEV_OTP", "true")
    monkeypatch.setenv("MM_STAFF_BOOTSTRAP_EMAILS", '["admin@example.test"]')
    settings = Settings(_env_file=None)
    assert settings.expose_dev_otp is True
    assert settings.staff_bootstrap_emails == ["admin@example.test"]
