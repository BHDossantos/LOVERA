"""Whether the API will start when no member could receive a sign-in code.

Sign-in is a one-time code. It reaches somebody either by email or, in a deployment that
allows it, in the `/auth/start` response. A deploy where neither is true answers every
endpoint, passes every health check, and cannot sign anybody in.

The guard used to ask "is this production?", on the reasoning that outside production the
code comes back in the response. That stops being true the moment `MM_EXPOSE_DEV_OTP` is
off — which is exactly what a publicly reachable staging deploy has to do, because an API
that hands the code to whoever asks lets anyone sign in as anyone. So staging fell straight
through the gap the guard exists to close.
"""
from __future__ import annotations

import pytest

from app.core.config import Settings, get_settings
from app.main import check_mail_transport


def settings_for(monkeypatch, **values):
    """`check_mail_transport` reads the cached settings, so the cache is what has to change."""
    base = dict(env="staging", mail_transport="auto", smtp_host=None, expose_dev_otp=False)
    base.update(values)
    s = Settings(**{k: v for k, v in base.items() if v is not None or k == "smtp_host"})
    monkeypatch.setattr(get_settings, "__wrapped__", lambda: s, raising=False)
    monkeypatch.setattr("app.main.get_settings", lambda: s)
    monkeypatch.setattr("app.core.mail.get_settings", lambda: s)
    monkeypatch.setattr("app.core.mail.get_sender", lambda: _Sender())
    monkeypatch.setattr("app.main.get_sender", lambda: _Sender())
    return s


class _Sender:
    def preflight(self) -> str:
        return "stub transport"


def test_staging_without_mail_or_a_returned_code_refuses_to_start(monkeypatch):
    """The case the old guard let through: no SMTP, no OTP in the response, clean boot."""
    settings_for(monkeypatch, env="staging", expose_dev_otp=False, smtp_host=None)
    with pytest.raises(RuntimeError) as e:
        check_mail_transport()
    assert "no member could receive one" in str(e.value)
    assert "MM_EXPOSE_DEV_OTP off" in str(e.value), "the message has to name what to change"


def test_production_without_mail_still_refuses(monkeypatch):
    """The case it already caught, which must keep working."""
    settings_for(monkeypatch, env="production", expose_dev_otp=True, smtp_host=None)
    with pytest.raises(RuntimeError) as e:
        check_mail_transport()
    assert "in production" in str(e.value)


def test_staging_with_a_mail_host_starts(monkeypatch):
    settings_for(monkeypatch, env="staging", expose_dev_otp=False, smtp_host="smtp.example.invalid")
    check_mail_transport()


def test_staging_that_returns_the_code_starts(monkeypatch):
    """Not a posture for a public URL, but it is a way for a member to get the code."""
    settings_for(monkeypatch, env="staging", expose_dev_otp=True, smtp_host=None)
    check_mail_transport()


def test_local_development_is_untouched(monkeypatch):
    """The everyday case: no SMTP, code in the response, boots without complaint."""
    settings_for(monkeypatch, env="local", expose_dev_otp=True, smtp_host=None)
    check_mail_transport()


def test_console_on_purpose_boots_and_complains(monkeypatch, caplog):
    settings_for(monkeypatch, env="staging", expose_dev_otp=False, smtp_host=None, mail_transport="console")
    with caplog.at_level("CRITICAL"):
        check_mail_transport()
    assert any("delivered to nobody" in r.getMessage() for r in caplog.records)
