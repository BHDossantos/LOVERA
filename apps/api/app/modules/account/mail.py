"""The sign-in email.

One message, four languages, no images and no links. A login code that arrives as
plain text with an inline code survives spam filters, text-only clients and the
screenshot a member sends support far better than a branded template does, and a
mail with no link cannot be reused for phishing practice against our own members.
"""
from __future__ import annotations

from html import escape

from app.core.mail import Message

# Member.locale is constrained to these four; anything else falls back to English.
_COPY: dict[str, dict[str, str]] = {
    "en": {
        "subject": "{code} is your {product} code",
        "greeting": "Here is your sign-in code:",
        "expiry": "It works once and expires in {minutes} minutes.",
        "unexpected": "If you did not ask to sign in, you can ignore this email — nobody can use the code without it.",
    },
    "it": {
        "subject": "{code} è il tuo codice {product}",
        "greeting": "Ecco il tuo codice di accesso:",
        "expiry": "È valido una sola volta e scade tra {minutes} minuti.",
        "unexpected": "Se non hai richiesto l'accesso, puoi ignorare questa email: senza il codice nessuno può entrare.",
    },
    "es": {
        "subject": "{code} es tu código de {product}",
        "greeting": "Este es tu código de acceso:",
        "expiry": "Sirve una sola vez y caduca en {minutes} minutos.",
        "unexpected": "Si no has pedido acceder, puedes ignorar este correo: sin el código nadie puede entrar.",
    },
    "pt": {
        "subject": "{code} é o seu código {product}",
        "greeting": "Este é o seu código de acesso:",
        "expiry": "Funciona uma única vez e expira em {minutes} minutos.",
        "unexpected": "Se não pediu para entrar, pode ignorar este email — sem o código ninguém consegue acessar.",
    },
}


def login_code_message(*, to: str, code: str, product: str, minutes: int, locale: str = "en") -> Message:
    copy = _COPY.get(locale, _COPY["en"])
    subject = copy["subject"].format(code=code, product=product)
    expiry = copy["expiry"].format(minutes=minutes)
    text = f"{copy['greeting']}\n\n{code}\n\n{expiry}\n\n{copy['unexpected']}\n\n— {product}"
    html = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
        'font-size:16px;line-height:1.5;color:#1b1b1f;max-width:34em">'
        f"<p>{escape(copy['greeting'])}</p>"
        '<p style="font-size:32px;font-weight:700;letter-spacing:0.18em;margin:24px 0">'
        f"{escape(code)}</p>"
        f"<p>{escape(expiry)}</p>"
        f'<p style="color:#5b5b66;font-size:14px">{escape(copy["unexpected"])}</p>'
        f'<p style="color:#5b5b66;font-size:14px">— {escape(product)}</p>'
        "</div>"
    )
    return Message(to=to, subject=subject, text=text, html=html)
