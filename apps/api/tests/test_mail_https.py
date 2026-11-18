"""HTTPS delivery works without SMTP and never falls back to leaking an OTP."""
import json
import logging

import httpx
import pytest

from app.core.config import Settings
from app.core.mail import MailError, Message, ResendSender, build_sender


def settings(**overrides):
    return Settings(**dict(dict(mail_transport="resend", resend_api_key="private-test-key",
                               mail_from="Lovera <login@example.com>"), **overrides))


@pytest.mark.parametrize("overrides", [
    {"resend_api_key": None}, {"resend_api_key": " "},
    {"mail_from": "Lovera <no-reply@localhost>"}, {"mail_from": ""},
    {"mail_reply_to": "invalid"}, {"mail_from": "login@example.com\r\nBcc: x@example.com"},
])
def test_missing_or_invalid_configuration_refuses_startup(monkeypatch, overrides):
    from app import main
    configured = settings(env="production", **overrides)
    monkeypatch.setattr(main, "get_settings", lambda: configured)
    monkeypatch.setattr(main, "get_sender", lambda: build_sender(configured))
    with pytest.raises(MailError):
        main.check_mail_transport()


def test_explicit_selection_and_preflight_do_not_send(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("preflight must not send email")
    monkeypatch.setattr("app.core.mail.httpx.post", forbidden)
    sender = build_sender(settings())
    assert isinstance(sender, ResendSender)
    assert "delivery has not been verified" in sender.preflight()
    assert settings(mail_transport="auto", smtp_host=None).resolved_mail_transport == "console"


def test_sends_documented_https_payload_without_logging_otp(monkeypatch, caplog):
    def post(url, **kwargs):
        assert url == "https://api.resend.com/emails"
        assert kwargs["timeout"] == 10.0
        assert kwargs["follow_redirects"] is False
        assert kwargs["headers"] == {"Authorization": "Bearer private-test-key"}
        assert kwargs["json"] == {
            "from": "Lovera <login@example.com>", "to": ["member@example.com"],
            "subject": "Code 123456", "text": "123456", "html": "<p>123456</p>",
            "headers": {"Auto-Submitted": "auto-generated"}, "reply_to": "help@example.com",
        }
        return httpx.Response(200, json={"id": "accepted-message"})
    monkeypatch.setattr("app.core.mail.httpx.post", post)
    with caplog.at_level(logging.INFO):
        build_sender(settings(mail_reply_to="help@example.com")).send(
            Message("member@example.com", "Code 123456", "123456", "<p>123456</p>"))
    for private in ("123456", "private-test-key", "member@example.com"):
        assert private not in caplog.text


@pytest.mark.parametrize("status,body", [
    (401, {"message": "123456 private-test-key"}), (429, {}), (500, {}),
    (302, {}), (200, {}), (200, {"id": ""}), (200, []), (200, "not-json"),
])
def test_rejection_or_invalid_acknowledgement_fails_closed(monkeypatch, status, body):
    response = httpx.Response(status, content=body if isinstance(body, str) else json.dumps(body))
    monkeypatch.setattr("app.core.mail.httpx.post", lambda *a, **kw: response)
    with pytest.raises(MailError) as error:
        build_sender(settings()).send(Message("member@example.com", "Code 123456", "123456"))
    assert "123456" not in str(error.value)
    assert "private-test-key" not in str(error.value)


def test_timeout_becomes_retryable_auth_failure_without_disclosing_secrets(monkeypatch, caplog):
    from app.core.errors import ApiError
    from app.modules.account import service
    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("123456 private-test-key")
    monkeypatch.setattr("app.core.mail.httpx.post", timeout)
    monkeypatch.setattr(service, "get_settings", settings)
    monkeypatch.setattr(service, "send_mail", build_sender(settings()).send)
    with caplog.at_level(logging.ERROR), pytest.raises(ApiError) as error:
        service.deliver_login_code("member@example.com", "123456", required=True)
    assert error.value.status == 503
    assert error.value.retryable
    assert "123456" not in caplog.text
    assert "private-test-key" not in caplog.text
