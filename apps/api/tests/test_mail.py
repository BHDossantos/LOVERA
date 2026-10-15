"""Sign-in codes have to leave the building.

The pilot's only authentication is a one-time code sent by email. Outside production
the API also returns that code in the response body, which means every other test in
this suite signs in without mail ever working — so these tests are the only place the
delivery path is exercised at all.
"""
from __future__ import annotations

import email
import email.policy
import logging

import pytest

from app.core.config import Settings
from app.core.mail import ConsoleSender, MailError, Message, SmtpSender, build_sender
from app.modules.account.mail import login_code_message
from tests.stub_smtp import StubSmtpServer, closed_port


def parse(raw: str) -> email.message.EmailMessage:
    """The modern policy, so get_content() decodes parts instead of handing back bytes."""
    return email.message_from_string(raw, policy=email.policy.default)


def smtp_settings(port: int, **over) -> Settings:
    base = dict(
        mail_transport="smtp",
        mail_from="Lovera <no-reply@example.test>",
        smtp_host="127.0.0.1",
        smtp_port=port,
        smtp_security="none",
        smtp_timeout_seconds=3,
    )
    base.update(over)
    return Settings(**base)


# --- transport selection -------------------------------------------------------

def test_auto_transport_is_console_without_a_host_and_smtp_with_one():
    assert Settings(mail_transport="auto", smtp_host=None).resolved_mail_transport == "console"
    assert Settings(mail_transport="auto", smtp_host="smtp.example.test").resolved_mail_transport == "smtp"


def test_explicit_transport_wins_over_the_presence_of_a_host():
    # An operator who sets console keeps console even after the host lands in the env,
    # which is what makes the production guard's "deliberate" branch meaningful.
    assert Settings(mail_transport="console", smtp_host="smtp.example.test").resolved_mail_transport == "console"


def test_smtp_transport_without_a_host_is_a_configuration_error():
    with pytest.raises(MailError, match="MM_SMTP_HOST"):
        build_sender(Settings(mail_transport="smtp", smtp_host=None))


def test_unknown_transport_names_itself():
    with pytest.raises(MailError, match="pigeon"):
        build_sender(Settings(mail_transport="pigeon"))


def test_console_sender_logs_the_body_so_local_work_has_an_inbox(caplog):
    with caplog.at_level(logging.WARNING, logger="mail"):
        ConsoleSender().send(Message(to="a@example.test", subject="s", text="123456"))
    assert "123456" in caplog.text
    assert "a@example.test" in caplog.text


# --- real SMTP conversation ----------------------------------------------------

def test_sends_a_multipart_message_over_a_real_socket():
    with StubSmtpServer() as server:
        sender = SmtpSender(smtp_settings(server.port, smtp_username="u", smtp_password="p"))
        sender.send(login_code_message(to="member@example.test", code="482913", product="Lovera", minutes=10))

    assert server.recipients == ["member@example.test"]
    assert server.authenticated, "credentials were configured but never offered"
    msg = parse(server.messages[0])
    assert msg["To"] == "member@example.test"
    assert msg["From"] == "Lovera <no-reply@example.test>"
    assert "482913" in msg["Subject"]
    assert msg["Auto-Submitted"] == "auto-generated"
    types = {part.get_content_type() for part in msg.walk() if not part.is_multipart()}
    assert types == {"text/plain", "text/html"}
    for part in msg.walk():
        if not part.is_multipart():
            assert "482913" in part.get_content(), f"{part.get_content_type()} lost the code"


def test_credentials_are_skipped_when_none_are_configured():
    with StubSmtpServer(offer_auth=False) as server:
        SmtpSender(smtp_settings(server.port)).send(Message(to="x@example.test", subject="s", text="t"))
    assert not server.authenticated
    assert len(server.messages) == 1


def test_an_unreachable_host_raises_rather_than_hanging():
    sender = SmtpSender(smtp_settings(closed_port()))
    with pytest.raises(MailError, match="could not reach"):
        sender.send(Message(to="x@example.test", subject="s", text="t"))


def test_a_refused_message_is_reported_as_a_rejection_not_a_connection_problem():
    with StubSmtpServer(reject_data=True) as server:
        sender = SmtpSender(smtp_settings(server.port))
        with pytest.raises(MailError, match="rejected"):
            sender.send(Message(to="x@example.test", subject="s", text="t"))


def test_preflight_distinguishes_reachable_from_not():
    with StubSmtpServer() as server:
        assert "is reachable" in SmtpSender(smtp_settings(server.port)).preflight()
    assert "NOT reachable" in SmtpSender(smtp_settings(closed_port())).preflight()


def test_a_bare_address_is_accepted_as_mail_from():
    with StubSmtpServer() as server:
        SmtpSender(smtp_settings(server.port, mail_from="no-reply@example.test")).send(
            Message(to="x@example.test", subject="s", text="t")
        )
    assert parse(server.messages[0])["From"] == "no-reply@example.test"


def test_reply_to_is_set_when_configured():
    with StubSmtpServer() as server:
        SmtpSender(smtp_settings(server.port, mail_reply_to="help@example.test")).send(
            Message(to="x@example.test", subject="s", text="t")
        )
    assert parse(server.messages[0])["Reply-To"] == "help@example.test"


# --- the message itself --------------------------------------------------------

@pytest.mark.parametrize("locale", ["en", "it", "es", "pt"])
def test_every_supported_locale_carries_the_code_and_the_expiry(locale):
    msg = login_code_message(to="m@example.test", code="100200", product="Lovera", minutes=10, locale=locale)
    assert "100200" in msg.subject
    for body in (msg.text, msg.html):
        assert "100200" in body
        assert "10" in body


def test_an_unknown_locale_falls_back_to_english():
    msg = login_code_message(to="m@example.test", code="100200", product="P", minutes=10, locale="de")
    assert msg.subject == login_code_message(to="m@example.test", code="100200", product="P", minutes=10).subject


def test_the_product_name_is_not_hardcoded_in_the_template():
    msg = login_code_message(to="m@example.test", code="100200", product="Something Else", minutes=10)
    assert "Something Else" in msg.subject
    assert "Lovera" not in msg.text


def test_the_message_offers_no_link_to_click():
    msg = login_code_message(to="m@example.test", code="100200", product="P", minutes=10)
    assert "http" not in msg.text
    assert "<a " not in (msg.html or "")


def test_the_html_escapes_a_product_name_that_contains_markup():
    msg = login_code_message(to="m@example.test", code="100200", product="<script>x</script>", minutes=10)
    assert "<script>" not in (msg.html or "")
    assert "&lt;script&gt;" in (msg.html or "")


# --- what the auth endpoint does with a failed send ---------------------------

def _boom(_message: Message) -> None:
    raise MailError("the stub mail host is on fire")


def test_production_fails_the_request_when_the_code_cannot_be_sent(monkeypatch, caplog):
    """In production the response carries no code, so a silent failure strands the member."""
    from app.core.errors import ApiError
    from app.modules.account import service

    monkeypatch.setattr(service, "send_mail", _boom)
    monkeypatch.setattr(service, "get_settings", lambda: smtp_settings(25))
    with caplog.at_level(logging.ERROR, logger="account"), pytest.raises(ApiError) as caught:
        service.deliver_login_code("member@example.test", "991122", required=True)
    assert caught.value.code == "DEPENDENCY_UNAVAILABLE"
    assert caught.value.status == 503
    assert caught.value.retryable is True
    # The log line runs in production, where it is not an inbox.
    assert "991122" not in caplog.text
    assert "member@example.test" in caplog.text


def test_local_work_survives_a_broken_mail_host(monkeypatch):
    from app.modules.account import service

    monkeypatch.setattr(service, "send_mail", _boom)
    monkeypatch.setattr(service, "get_settings", lambda: smtp_settings(25))
    assert service.deliver_login_code("member@example.test", "991122", required=False) is False


def test_the_console_transport_reports_that_nothing_was_delivered(monkeypatch):
    from app.modules.account import service

    sent: list[Message] = []
    monkeypatch.setattr(service, "send_mail", sent.append)
    monkeypatch.setattr(service, "get_settings", lambda: Settings(mail_transport="console"))
    assert service.deliver_login_code("member@example.test", "991122") is False
    assert "991122" in sent[0].subject


def test_a_real_host_reports_that_something_was_delivered(monkeypatch):
    from app.modules.account import service

    with StubSmtpServer() as server:
        settings = smtp_settings(server.port)
        monkeypatch.setattr(service, "get_settings", lambda: settings)
        monkeypatch.setattr(service, "send_mail", build_sender(settings).send)
        assert service.deliver_login_code("member@example.test", "991122", "it") is True
    body = parse(server.messages[0])
    assert "991122" in body["Subject"]
    assert "codice" in body["Subject"]


def test_the_email_quotes_the_same_expiry_the_challenge_uses():
    from app.modules.account.service import CHALLENGE_TTL_MINUTES

    msg = login_code_message(to="m@example.test", code="1", product="P", minutes=CHALLENGE_TTL_MINUTES)
    assert str(CHALLENGE_TTL_MINUTES) in msg.text


# --- the production startup guard ---------------------------------------------

def test_production_refuses_to_start_with_no_mail_host(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "get_settings", lambda: Settings(env="production", mail_transport="auto", smtp_host=None))
    with pytest.raises(RuntimeError, match="MM_SMTP_HOST"):
        main.check_mail_transport()


def test_production_starts_but_shouts_when_console_is_deliberate(monkeypatch, caplog):
    from app import main

    monkeypatch.setattr(main, "get_settings", lambda: Settings(env="production", mail_transport="console"))
    monkeypatch.setattr(main, "get_sender", ConsoleSender)
    with caplog.at_level(logging.CRITICAL, logger="app"):
        main.check_mail_transport()
    assert "delivered to nobody" in caplog.text


def test_a_non_production_env_starts_with_no_mail_at_all(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "get_settings", lambda: Settings(env="local", mail_transport="auto", smtp_host=None))
    monkeypatch.setattr(main, "get_sender", ConsoleSender)
    main.check_mail_transport()


def test_production_logs_whether_its_configured_host_answers(monkeypatch, caplog):
    from app import main

    with StubSmtpServer() as server:
        settings = smtp_settings(server.port, env="production")
        monkeypatch.setattr(main, "get_settings", lambda: settings)
        monkeypatch.setattr(main, "get_sender", lambda: build_sender(settings))
        with caplog.at_level(logging.INFO, logger="app"):
            main.check_mail_transport()
    assert "is reachable" in caplog.text
