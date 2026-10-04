"""Outbound email.

Deliberately vendor-neutral. Every mail provider worth using for a pilot — Resend,
Postmark, SendGrid, Mailgun, SES, Fastmail — speaks SMTP with a username and a
password, so SMTP *is* the integration. Swapping provider is five secrets, not a
code change, and nothing in this module needs to know which one is behind the host.

Two transports exist:

  smtp     — the real one. Any provider, configured by MM_SMTP_*.
  console  — logs the message, including the one-time code, and delivers nothing.
             Correct for local work and CI, where the API also returns the code in
             the response body. Never correct in production: it means every member
             requests a login code that no one receives.

`MM_MAIL_TRANSPORT=auto` (the default) picks smtp when a host is configured and
console when one is not, so a developer needs no mail setup and a deploy that
forgets its SMTP secrets is caught at boot rather than by its first stranded user.
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from functools import lru_cache
from typing import Protocol

from app.core.config import Settings, get_settings

log = logging.getLogger("mail")


class MailError(RuntimeError):
    """Delivery failed. The caller decides whether that is fatal for the request."""


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    text: str
    html: str | None = None


class Sender(Protocol):
    name: str

    def send(self, message: Message) -> None: ...

    def preflight(self) -> str: ...


class ConsoleSender:
    """Writes the mail to the log. Delivers nothing."""

    name = "console"

    def send(self, message: Message) -> None:
        # The body is logged in full on purpose: in local work and CI this log *is*
        # the inbox. The transport is never selected in production unless an operator
        # names it explicitly, and app startup shouts about it when they do.
        log.warning("console mail transport — not delivered to %s: %s\n%s", message.to, message.subject, message.text)

    def preflight(self) -> str:
        return "console transport; no mail will be delivered"


class SmtpSender:
    name = "smtp"

    def __init__(self, settings: Settings) -> None:
        if not settings.smtp_host:
            raise MailError("MM_SMTP_HOST is not set, so the smtp transport cannot be used.")
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.username = settings.smtp_username
        self.password = settings.smtp_password
        self.security = settings.smtp_security
        self.timeout = settings.smtp_timeout_seconds
        self.mail_from = settings.mail_from
        self.reply_to = settings.mail_reply_to

    def _connect(self) -> smtplib.SMTP:
        if self.security == "ssl":
            client: smtplib.SMTP = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=ssl.create_default_context())
        else:
            client = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
            if self.security == "starttls":
                client.starttls(context=ssl.create_default_context())
        # A provider that takes credentials wants them after the channel is encrypted,
        # which is why this sits below starttls rather than beside the connect.
        if self.username and self.password:
            client.login(self.username, self.password)
        return client

    def send(self, message: Message) -> None:
        mail = EmailMessage()
        mail["From"] = _format_address(self.mail_from)
        mail["To"] = message.to
        mail["Subject"] = message.subject
        if self.reply_to:
            mail["Reply-To"] = _format_address(self.reply_to)
        # Transactional mail that one-click-unsubscribes is mail the member cannot
        # log in after, so no List-Unsubscribe here. Marketing mail is a separate path.
        mail["Auto-Submitted"] = "auto-generated"
        mail.set_content(message.text)
        if message.html:
            mail.add_alternative(message.html, subtype="html")
        try:
            client = self._connect()
        except (OSError, smtplib.SMTPException) as exc:
            raise MailError(f"could not reach the mail host {self.host}:{self.port}: {exc}") from exc
        try:
            client.send_message(mail)
        except smtplib.SMTPException as exc:
            raise MailError(f"the mail host rejected the message: {exc}") from exc
        finally:
            try:
                client.quit()
            except smtplib.SMTPException:
                # The message is already accepted at this point; a rude goodbye is not
                # a delivery failure and must not be reported to the caller as one.
                client.close()
        log.info("sent %r to %s via %s", message.subject, message.to, self.host)

    def preflight(self) -> str:
        """Open and close a connection so a misconfiguration surfaces at boot.

        Never raises: a mail host that is briefly unreachable should not stop the API
        from serving everything that does not need mail.
        """
        try:
            self._connect().quit()
        except (MailError, OSError, smtplib.SMTPException) as exc:
            return f"smtp transport at {self.host}:{self.port} is NOT reachable: {exc}"
        return f"smtp transport at {self.host}:{self.port} is reachable"


def _format_address(raw: str) -> str:
    """Accept either `user@host` or `Name <user@host>` in the same setting."""
    name, address = parseaddr(raw)
    return formataddr((name, address)) if address else raw


def build_sender(settings: Settings) -> Sender:
    transport = settings.resolved_mail_transport
    if transport == "smtp":
        return SmtpSender(settings)
    if transport == "console":
        return ConsoleSender()
    raise MailError(f"MM_MAIL_TRANSPORT={transport!r} is not a transport; use auto, smtp or console.")


@lru_cache
def get_sender() -> Sender:
    return build_sender(get_settings())


def send(message: Message) -> None:
    get_sender().send(message)
