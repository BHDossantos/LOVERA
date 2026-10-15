"""Asking Apple and Google whether a receipt is real.

`POST /subscriptions/store-purchase` is an endpoint any signed-in member can call with any JSON
they like. The only thing between it and a free upgrade to the most expensive tier is this file,
so the shape of everything here is "refuse unless the store itself said yes".

Two ideas run through it.

**A refusal and an outage are different answers.** `ReceiptRefused` means the store answered and
the answer was no — the member must not be granted anything, and telling them to try again would
be a lie. `ReceiptUnavailable` means we never got an answer, which is our problem rather than
theirs: the store may well have charged them, so the message has to say the money is the store's
to refund and the purchase can be restored later. Collapsing the two into one error is how people
end up paying for nothing.

**The transport is the trust boundary, not the signature.** Apple hands back a JWS, and the
obvious instinct is to verify it. We do not, deliberately: that JWS arrives in the body of a TLS
response from `api.storekit.apple.com`, answering a request signed with our own App Store Connect
private key. It never passed through the member's phone. Verifying the signature would mean
pinning Apple's root, walking the x5c chain and keeping it current — a new way for billing to
break on a certificate rotation, guarding a path nothing untrusted travels. The moment we accept
a `signedTransactionInfo` handed to us *by a client*, that reasoning is void and the chain check
becomes mandatory. We do not, and there is a test that says so.

Endpoints and field names here were taken from Apple's own `app-store-server-library-python` and
from Google's `androidpublisher` v3 discovery document, not from memory or from blog posts — most
of which still give Apple's older `api.storekit.itunes.apple.com` hosts, which are not these.
"""
from __future__ import annotations

import base64
import json
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx
import jwt

from app.core.config import get_settings

log = logging.getLogger(__name__)

APP_STORE_PRODUCTION = "https://api.storekit.apple.com"
APP_STORE_SANDBOX = "https://api.storekit-sandbox.apple.com"
APP_STORE_AUDIENCE = "appstoreconnect-v1"
# Apple's answer for "no such transaction here". It is also how you find out which environment a
# transaction belongs to: there is no flag on the id, you ask production and fall back.
APP_STORE_TRANSACTION_NOT_FOUND = 4040010

PLAY_API = "https://androidpublisher.googleapis.com"
PLAY_TOKEN_URL = "https://oauth2.googleapis.com/token"
PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
PLAY_JWT_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer"
# A subscription in grace is one whose renewal payment failed and which Google is still retrying.
# The member kept their side of the bargain, so they keep their entitlement while that plays out.
PLAY_ACCEPTED_STATES = {"SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"}

# Short on purpose. A member is standing in front of the Membership screen with a charge already
# made; a thirty-second hang is worse than a clean "we could not check that just now".
TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _client() -> httpx.Client:
    """The one place an outbound client is made, so a test can replace it with a mock transport.

    Tests that reach the real App Store would be slow, flaky and dependent on somebody's sandbox
    account staying alive, so they do not: they swap this out and assert on the request we would
    have sent, which is the part that is actually ours to get right.
    """
    return httpx.Client(timeout=TIMEOUT)


class ReceiptRefused(Exception):
    """The store answered, and the answer was no. Grant nothing."""

    def __init__(self, reason: str, message: str):
        super().__init__(reason)
        self.reason = reason
        self.message = message


class ReceiptUnavailable(Exception):
    """We could not reach an answer. Grant nothing, but do not blame the member."""

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True)
class VerifiedReceipt:
    """What the store told us, reduced to the parts we act on."""

    product_id: str
    transaction_id: str
    expires_at: datetime | None
    environment: str  # production | sandbox
    auto_renewing: bool | None = None


# --------------------------------------------------------------------------------------------
# Whether we are in a position to ask at all
# --------------------------------------------------------------------------------------------


def missing_configuration(store: str) -> str | None:
    """The reason this store cannot be verified, or None if it can.

    `store_status()` calls this so the phone is told the truth before it draws anything. A
    purchase button that leads to "we cannot verify that" is worse than no button, and on iOS a
    purchase path that does not work is a guideline 2.1 rejection on its own.
    """
    settings = get_settings()
    if store == "app_store":
        missing = [
            name
            for name, value in (
                ("MM_APP_STORE_ISSUER_ID", settings.app_store_issuer_id),
                ("MM_APP_STORE_KEY_ID", settings.app_store_key_id),
                ("MM_APP_STORE_PRIVATE_KEY", settings.app_store_private_key),
            )
            if not value
        ]
        if missing:
            return f"App Store receipt verification is not configured ({', '.join(missing)} unset)."
        return None
    if store == "play_store":
        if not settings.play_service_account_json:
            return "Play receipt verification is not configured (MM_PLAY_SERVICE_ACCOUNT_JSON unset)."
        try:
            creds = _play_credentials()
        except ReceiptUnavailable as exc:
            return f"The Play service account key cannot be read: {exc.detail}"
        for field in ("client_email", "private_key"):
            if not creds.get(field):
                return f"The Play service account key has no {field}."
        return None
    return f"Unknown store {store!r}."


def verify(store: str, product_id: str, token: str) -> VerifiedReceipt:
    """Ask the store. Raises rather than returning a falsy result, so this cannot be ignored."""
    if store == "app_store":
        return _verify_app_store(product_id, token)
    if store == "play_store":
        return _verify_play_store(product_id, token)
    raise ReceiptRefused("unknown_store", "That store is not one we sell through.")


# --------------------------------------------------------------------------------------------
# Apple
# --------------------------------------------------------------------------------------------


def _apple_private_key() -> str:
    """The .p8 contents, however the operator managed to get them into an environment variable.

    A PEM is multi-line and environment variables are where multi-line strings go to be mangled,
    so three shapes are accepted: the PEM as-is, the PEM with literal backslash-n, and the whole
    file base64'd. The alternative is an operator discovering at the first real purchase that
    their key arrived as one line and nothing works.
    """
    raw = (get_settings().app_store_private_key or "").strip()
    if not raw:
        raise ReceiptUnavailable("no App Store private key is configured")
    key = raw.replace("\\n", "\n")
    if "BEGIN" not in key:
        try:
            key = base64.b64decode(key).decode()
        except Exception:  # noqa: BLE001 - any failure here means "not base64", and the next
            pass  # step produces a better message than a decoding traceback would.
    if "BEGIN" not in key:
        raise ReceiptUnavailable("the App Store private key is not a PEM and is not base64 of one")
    return key


def _apple_token() -> str:
    settings = get_settings()
    now = int(time.time())
    return jwt.encode(
        {
            "iss": settings.app_store_issuer_id,
            "iat": now,
            # Apple rejects anything longer than an hour; five minutes is plenty for one call and
            # keeps a leaked token almost worthless.
            "exp": now + 300,
            "aud": APP_STORE_AUDIENCE,
            "bid": settings.app_store_bundle_id,
        },
        _apple_private_key(),
        algorithm="ES256",
        headers={"kid": settings.app_store_key_id},
    )


def _apple_bases() -> list[str]:
    """Where to look, in order.

    A transaction id does not say which environment it came from, so the documented approach is
    to ask production and treat "not found" as "try sandbox". `app_store_environment` pins it when
    an operator wants no ambiguity — and pinning production is the right answer for a deployment
    that must never honour a sandbox purchase.
    """
    env = get_settings().app_store_environment
    if env == "production":
        return [APP_STORE_PRODUCTION]
    if env == "sandbox":
        return [APP_STORE_SANDBOX]
    return [APP_STORE_PRODUCTION, APP_STORE_SANDBOX]


def _decode_jws_payload(token: str) -> dict[str, Any]:
    """Read the middle segment of a JWS. See the module docstring on why the signature is not checked."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ReceiptUnavailable("the App Store returned something that is not a JWS")
    segment = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(segment))
    except Exception as exc:  # noqa: BLE001
        raise ReceiptUnavailable(f"the App Store transaction payload could not be read: {exc}") from exc


def _apple_ms(value: Any) -> datetime | None:
    if not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc)


def _verify_app_store(product_id: str, transaction_id: str) -> VerifiedReceipt:
    settings = get_settings()
    headers = {"Authorization": f"Bearer {_apple_token()}", "Accept": "application/json"}
    path = f"/inApps/v1/transactions/{quote(transaction_id, safe='')}"

    bases = _apple_bases()
    last_error: str = "the App Store did not recognise that transaction"
    body: dict[str, Any] | None = None
    try:
        with _client() as client:
            for index, base in enumerate(bases):
                response = client.get(base + path, headers=headers)
                if response.status_code == 200:
                    body = response.json()
                    break
                payload = _json_or_empty(response)
                if response.status_code == 404 and payload.get("errorCode") == APP_STORE_TRANSACTION_NOT_FOUND:
                    last_error = "no such transaction in any environment"
                    if index + 1 < len(bases):
                        continue
                    raise ReceiptRefused(
                        "unknown_transaction",
                        "The store does not have a record of that purchase.",
                    )
                if response.status_code in (401, 403):
                    # Our credentials, not the member's receipt.
                    raise ReceiptUnavailable(
                        f"the App Store rejected our API key ({response.status_code}); check "
                        f"MM_APP_STORE_ISSUER_ID, MM_APP_STORE_KEY_ID and MM_APP_STORE_PRIVATE_KEY"
                    )
                raise ReceiptUnavailable(
                    f"the App Store answered {response.status_code} ({payload.get('errorMessage') or 'no detail'})"
                )
    except httpx.HTTPError as exc:
        raise ReceiptUnavailable(f"the App Store could not be reached: {exc}") from exc

    if body is None:
        raise ReceiptUnavailable(last_error)

    signed = body.get("signedTransactionInfo")
    if not isinstance(signed, str):
        raise ReceiptUnavailable("the App Store response carried no signedTransactionInfo")
    info = _decode_jws_payload(signed)

    bundle_id = info.get("bundleId")
    if bundle_id and bundle_id != settings.app_store_bundle_id:
        # A real receipt, for somebody else's app.
        raise ReceiptRefused("wrong_app", "That purchase was not made in this app.")

    if info.get("productId") != product_id:
        raise ReceiptRefused("product_mismatch", "That purchase is for a different product.")

    if info.get("revocationDate") is not None:
        raise ReceiptRefused("revoked", "That purchase was refunded or revoked by the store.")

    environment = str(info.get("environment") or "").lower() or "production"
    expires_at = _apple_ms(info.get("expiresDate"))
    if expires_at is not None and expires_at <= datetime.now(timezone.utc):
        raise ReceiptRefused("expired", "That subscription has already ended.")

    return VerifiedReceipt(
        product_id=product_id,
        transaction_id=str(info.get("transactionId") or transaction_id),
        expires_at=expires_at,
        environment=environment,
    )


def _json_or_empty(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except Exception:  # noqa: BLE001
        return {}
    return payload if isinstance(payload, dict) else {}


# --------------------------------------------------------------------------------------------
# Google Play
# --------------------------------------------------------------------------------------------

_play_token_lock = threading.Lock()
_play_token_cache: tuple[str, float] | None = None


def reset_play_token_cache() -> None:
    """For tests, and for an operator rotating the key without a restart."""
    global _play_token_cache
    with _play_token_lock:
        _play_token_cache = None


def _play_credentials() -> dict[str, Any]:
    raw = (get_settings().play_service_account_json or "").strip()
    if not raw:
        raise ReceiptUnavailable("no Play service account key is configured")
    text = raw
    if not text.startswith("{"):
        # The key is a JSON file with embedded newlines in the private key; base64 is the sane way
        # to carry it in one environment variable, so both shapes are accepted.
        try:
            text = base64.b64decode(text).decode()
        except Exception as exc:  # noqa: BLE001
            raise ReceiptUnavailable(f"it is neither JSON nor base64 ({exc})") from exc
    try:
        creds = json.loads(text)
    except Exception as exc:  # noqa: BLE001
        raise ReceiptUnavailable(f"it is not valid JSON ({exc})") from exc
    if not isinstance(creds, dict):
        raise ReceiptUnavailable("it is not a JSON object")
    return creds


def _play_access_token() -> str:
    """A short-lived OAuth token, minted from the service account key and cached until it nearly expires.

    Cached because a purchase is not the only thing that will ever call Play, and minting a token
    per call turns one member's tap into two round trips to Google.
    """
    global _play_token_cache
    with _play_token_lock:
        if _play_token_cache and _play_token_cache[1] > time.time() + 60:
            return _play_token_cache[0]

        creds = _play_credentials()
        token_uri = creds.get("token_uri") or PLAY_TOKEN_URL
        now = int(time.time())
        try:
            assertion = jwt.encode(
                {
                    "iss": creds["client_email"],
                    "scope": PLAY_SCOPE,
                    "aud": token_uri,
                    "iat": now,
                    "exp": now + 3600,
                },
                creds["private_key"],
                algorithm="RS256",
            )
        except KeyError as exc:
            raise ReceiptUnavailable(f"the Play service account key has no {exc.args[0]}") from exc
        except Exception as exc:  # noqa: BLE001
            raise ReceiptUnavailable(f"the Play service account key could not sign: {exc}") from exc

        try:
            with _client() as client:
                response = client.post(
                    token_uri,
                    data={"grant_type": PLAY_JWT_GRANT, "assertion": assertion},
                )
        except httpx.HTTPError as exc:
            raise ReceiptUnavailable(f"Google's token endpoint could not be reached: {exc}") from exc

        if response.status_code != 200:
            detail = _json_or_empty(response)
            raise ReceiptUnavailable(
                f"Google refused the service account ({response.status_code}: "
                f"{detail.get('error_description') or detail.get('error') or 'no detail'})"
            )
        payload = _json_or_empty(response)
        token = payload.get("access_token")
        if not token:
            raise ReceiptUnavailable("Google's token response carried no access_token")
        _play_token_cache = (token, time.time() + float(payload.get("expires_in") or 3600))
        return token


def _play_time(value: Any) -> datetime | None:
    """Parse an RFC 3339 timestamp. Google sends nanoseconds, which `fromisoformat` will not take."""
    if not isinstance(value, str) or not value:
        return None
    text = value.replace("Z", "+00:00")
    if "." in text:
        head, _, tail = text.partition(".")
        fraction, sign, offset = _split_offset(tail)
        text = f"{head}.{fraction[:6]}{sign}{offset}"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _split_offset(tail: str) -> tuple[str, str, str]:
    for sign in ("+", "-"):
        if sign in tail:
            fraction, _, offset = tail.partition(sign)
            return fraction, sign, offset
    return tail, "", ""


def _verify_play_store(product_id: str, purchase_token: str) -> VerifiedReceipt:
    settings = get_settings()
    package = settings.play_package_name
    url = (
        f"{PLAY_API}/androidpublisher/v3/applications/{quote(package, safe='')}"
        f"/purchases/subscriptionsv2/tokens/{quote(purchase_token, safe='')}"
    )
    headers = {"Authorization": f"Bearer {_play_access_token()}", "Accept": "application/json"}

    try:
        with _client() as client:
            response = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise ReceiptUnavailable(f"Google Play could not be reached: {exc}") from exc

    if response.status_code == 404:
        raise ReceiptRefused("unknown_transaction", "The store does not have a record of that purchase.")
    if response.status_code in (401, 403):
        raise ReceiptUnavailable(
            f"Google refused our service account ({response.status_code}). It needs the "
            f"'View app information' and 'Release apps to testing tracks' permissions on {package}."
        )
    if response.status_code != 200:
        detail = _json_or_empty(response).get("error", {})
        raise ReceiptUnavailable(
            f"Google Play answered {response.status_code} ({detail.get('message') or 'no detail'})"
        )

    body = _json_or_empty(response)
    state = body.get("subscriptionState")
    if state not in PLAY_ACCEPTED_STATES:
        raise ReceiptRefused("not_active", _play_state_message(state))

    line_items = body.get("lineItems") or []
    matched = next((item for item in line_items if item.get("productId") == product_id), None)
    if matched is None:
        raise ReceiptRefused("product_mismatch", "That purchase is for a different product.")

    environment = "sandbox" if body.get("testPurchase") is not None else "production"
    expires_at = _play_time(matched.get("expiryTime"))
    auto_renewing = (matched.get("autoRenewingPlan") or {}).get("autoRenewEnabled")

    _acknowledge_play(package, product_id, purchase_token, body, headers)

    return VerifiedReceipt(
        product_id=product_id,
        transaction_id=purchase_token,
        expires_at=expires_at,
        environment=environment,
        auto_renewing=auto_renewing if isinstance(auto_renewing, bool) else None,
    )


def _play_state_message(state: Any) -> str:
    return {
        "SUBSCRIPTION_STATE_PENDING": "That purchase has not completed yet. Try again once the store confirms it.",
        "SUBSCRIPTION_STATE_PAUSED": "That subscription is paused. Resume it in the Play Store and we will pick it up.",
        "SUBSCRIPTION_STATE_ON_HOLD": "That subscription is on hold because a payment did not go through.",
        "SUBSCRIPTION_STATE_CANCELED": "That subscription has been cancelled.",
        "SUBSCRIPTION_STATE_EXPIRED": "That subscription has already ended.",
        "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED": "That purchase was cancelled before it completed.",
    }.get(str(state), "The store says that subscription is not active.")


def _acknowledge_play(
    package: str, product_id: str, purchase_token: str, body: dict[str, Any], headers: dict[str, str]
) -> None:
    """Tell Google we have honoured the purchase.

    This is not bookkeeping: Google **automatically refunds and revokes** a subscription that is
    not acknowledged within three days. Skipping it means every member who buys is silently
    refunded later and loses what they paid for, and the symptom — churn with no cancellations —
    looks nothing like the cause.

    A failure here never refuses the purchase. The member has paid and the store said the
    subscription is active; the right response is to grant it and shout in the log, because the
    call can be retried and withholding the entitlement helps nobody.
    """
    if body.get("acknowledgementState") != "ACKNOWLEDGEMENT_STATE_PENDING":
        return
    url = (
        f"{PLAY_API}/androidpublisher/v3/applications/{quote(package, safe='')}"
        f"/purchases/subscriptions/{quote(product_id, safe='')}"
        f"/tokens/{quote(purchase_token, safe='')}:acknowledge"
    )
    try:
        with _client() as client:
            response = client.post(url, headers=headers, json={})
        if response.status_code >= 300:
            log.error(
                "play: acknowledge failed with %s for %s. Google refunds unacknowledged purchases "
                "after three days — this needs retrying.",
                response.status_code,
                product_id,
            )
    except httpx.HTTPError as exc:
        log.error(
            "play: acknowledge could not be sent for %s (%s). Google refunds unacknowledged "
            "purchases after three days — this needs retrying.",
            product_id,
            exc,
        )
