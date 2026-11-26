"""Secrets redaction, ported from Jennifer (src/security/redaction.ts). Keep in sync there.

Conservative by design: false positives are cheaper than a leaked token or
one-time code. Some patterns are adapted from OpenJarvis
security/credential_stripper.py (Apache-2.0); see THIRD_PARTY_LICENSES.
"""
import re

PATTERNS = [
    (re.compile('\\bBearer\\s+[A-Za-z0-9._~+/=-]{8,}', re.I), 'Bearer [REDACTED]'),
    (re.compile('\\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}', 0), '[REDACTED_API_KEY]'),
    (re.compile('\\bya29\\.[A-Za-z0-9._-]+', 0), '[REDACTED_OAUTH_TOKEN]'),
    (re.compile('\\bAKIA[0-9A-Z]{16}\\b', 0), '[REDACTED_AWS_KEY]'),
    (re.compile('\\bgh[pousr]_[A-Za-z0-9]{36,}\\b', 0), '[REDACTED_GITHUB_TOKEN]'),
    (re.compile('\\bxox[abposr]-[0-9A-Za-z-]{10,}', 0), '[REDACTED_SLACK_TOKEN]'),
    (re.compile('\\b1\\/\\/[A-Za-z0-9._-]{20,}', 0), '[REDACTED_REFRESH_TOKEN]'),
    (re.compile('("?(?:refresh_token|access_token|client_secret|password|api_key|secret)"?\\s*[:=]\\s*)"[^"]*"', re.I), '\\1"[REDACTED]"'),
    (re.compile('\\b(?:\\d[ -]?){13,19}\\b', 0), '[REDACTED_CARD]'),
    (re.compile('\\b(cvv|cvc|security code)\\b\\D{0,12}\\d{3,4}\\b', re.I), '\\1 [REDACTED]'),
    (re.compile('\\b(code|otp|verification code|passcode|pin)\\b(\\s*(?:is|:)?\\s*)\\d{4,8}\\b', re.I), '\\1\\2[REDACTED_CODE]'),
]


def redact_secrets(text: str) -> str:
    out = text
    for rx, repl in PATTERNS:
        out = rx.sub(repl, out)
    return out


def contains_authentication_code(text: str) -> bool:
    return bool(re.search(r"\b(verification code|one[- ]time (?:pass)?code|otp|security code|2fa code|login code)\b", text, re.I))
