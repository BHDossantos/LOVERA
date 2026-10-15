"""What happens when a receipt arrives, and what must never happen.

`POST /subscriptions/store-purchase` takes a store name, a product id and a string, from any
signed-in member. Until this file, `app_store`/`play_store` mode refused everything outright
rather than pretend to verify, because a stub that returns success is the one bug whose symptom
is "everybody has Concierge for nothing".

The tests below are about the three ways that goes wrong once verification is real:

  - **a no from the store is honoured as a no** — expired, revoked, cancelled, for another app,
    for another product. Each of those is a real receipt in the sense that it exists; none of
    them is a receipt for a thing this member may have;
  - **an outage is not a no** — if we cannot reach Apple, the member may still have been charged,
    so nothing is granted but the message does not tell them the purchase failed. The two are
    different errors on purpose and that is asserted;
  - **nothing untrusted decides anything** — the JWS is read from Apple's own authenticated
    response, so what the client sent can only ever be a lookup key.

No test here touches the network. `stores._client` is the single place an outbound client is
built, and every test replaces it with a mock transport, which also lets us assert on the request
we would have sent — the signing, the hosts, the fallback — rather than only on what we do with
the answer.
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from app.core import config
from app.modules.billing import stores

from tests.conftest import Actor, unique_email

BUNDLE_ID = "com.joinlovera.app"


# --------------------------------------------------------------------------------------------
# Keys and fixtures
# --------------------------------------------------------------------------------------------


def _ec_key_pem() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def _rsa_key_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def _public_pem(private_pem: str) -> str:
    """The verifying half.

    Signature checks in these tests go through the public key even where PyJWT would tolerate the
    private one, because "tolerate" is a property of the version installed today.
    """
    key = serialization.load_pem_private_key(private_pem.encode(), password=None)
    return key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


@pytest.fixture(scope="module")
def ec_key() -> str:
    return _ec_key_pem()


@pytest.fixture(scope="module")
def ec_public(ec_key) -> str:
    return _public_pem(ec_key)


@pytest.fixture(scope="module")
def rsa_key() -> str:
    return _rsa_key_pem()


@pytest.fixture(scope="module")
def rsa_public(rsa_key) -> str:
    return _public_pem(rsa_key)


@pytest.fixture
def apple(monkeypatch, ec_key):
    """Configure App Store verification against a throwaway key."""
    settings = config.get_settings()
    monkeypatch.setattr(settings, "store_validation", "app_store", raising=False)
    monkeypatch.setattr(settings, "app_store_issuer_id", "57246542-96fe-1a63-e053-0824d011072a", raising=False)
    monkeypatch.setattr(settings, "app_store_key_id", "GNB9AWW5WM", raising=False)
    monkeypatch.setattr(settings, "app_store_private_key", ec_key, raising=False)
    monkeypatch.setattr(settings, "app_store_bundle_id", BUNDLE_ID, raising=False)
    monkeypatch.setattr(settings, "app_store_environment", "auto", raising=False)
    return settings


@pytest.fixture
def play(monkeypatch, rsa_key):
    """Configure Play verification against a throwaway service account."""
    settings = config.get_settings()
    creds = {
        "type": "service_account",
        "client_email": "lovera-eas-submit@lovera.iam.gserviceaccount.com",
        "private_key": rsa_key,
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    monkeypatch.setattr(settings, "store_validation", "play_store", raising=False)
    monkeypatch.setattr(settings, "play_service_account_json", json.dumps(creds), raising=False)
    monkeypatch.setattr(settings, "play_package_name", BUNDLE_ID, raising=False)
    stores.reset_play_token_cache()
    yield settings
    stores.reset_play_token_cache()


def transport(monkeypatch, handler):
    """Point `stores` at a mock transport and hand back the list of requests it saw."""
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(
        stores, "_client", lambda: httpx.Client(transport=httpx.MockTransport(record), timeout=stores.TIMEOUT)
    )
    return seen


def signed_transaction(**over) -> str:
    """A JWS shaped like Apple's, signed with a key nobody checks — see the module docstring."""
    payload = {
        "transactionId": "2000000800000001",
        "originalTransactionId": "2000000800000001",
        "bundleId": BUNDLE_ID,
        "productId": "pro_monthly",
        "purchaseDate": 1_760_000_000_000,
        "expiresDate": int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp() * 1000),
        "type": "Auto-Renewable Subscription",
        "environment": "Production",
        **over,
    }
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    head = base64.urlsafe_b64encode(json.dumps({"alg": "ES256", "x5c": ["..."]}).encode()).decode().rstrip("=")
    return f"{head}.{body}.{base64.urlsafe_b64encode(b'signature').decode().rstrip('=')}"


def play_subscription(**over) -> dict:
    expiry = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S.%f123Z")
    body = {
        "kind": "androidpublisher#subscriptionPurchaseV2",
        "startTime": "2026-10-01T10:00:00.000Z",
        "regionCode": "IT",
        "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
        "acknowledgementState": "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
        "latestOrderId": "GPA.1234-5678-9012-34567",
        "lineItems": [
            {
                "productId": "pro_monthly",
                "expiryTime": expiry,
                "autoRenewingPlan": {"autoRenewEnabled": True},
            }
        ],
    }
    body.update(over)
    return body


def play_handler(subscription: dict | None = None, *, get_status: int = 200, ack_status: int = 200):
    """A transport that answers Google's token endpoint, the subscription read, and acknowledge."""

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "ya29.test", "expires_in": 3600})
        if request.url.path.endswith(":acknowledge"):
            return httpx.Response(ack_status, json={})
        if get_status != 200:
            return httpx.Response(get_status, json={"error": {"message": "nope"}})
        return httpx.Response(200, json=subscription if subscription is not None else play_subscription())

    return handle


def member(client, prefix: str) -> Actor:
    """A signed-in member and nothing more — billing takes `current_principal`, not `active_member`.

    Running these through onboarding would add members to the shared matching pool and turn
    unrelated introduction tests red, which is how this helper came to exist in test_pricing.py.
    """
    a = Actor(client, unique_email(prefix))
    a.sign_in()
    return a


# --------------------------------------------------------------------------------------------
# Apple: what we send
# --------------------------------------------------------------------------------------------


def test_the_app_store_request_is_signed_the_way_apple_requires(monkeypatch, apple, ec_public):
    seen = transport(monkeypatch, lambda r: httpx.Response(200, json={"signedTransactionInfo": signed_transaction()}))

    stores.verify("app_store", "pro_monthly", "2000000800000001")

    assert len(seen) == 1
    request = seen[0]
    assert request.url.host == "api.storekit.apple.com", "production is asked first"
    assert request.url.path == "/inApps/v1/transactions/2000000800000001"

    token = request.headers["Authorization"].removeprefix("Bearer ")
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "ES256"
    assert header["kid"] == "GNB9AWW5WM"
    claims = jwt.decode(token, ec_public, algorithms=["ES256"], audience="appstoreconnect-v1")
    assert claims["iss"] == "57246542-96fe-1a63-e053-0824d011072a"
    assert claims["bid"] == BUNDLE_ID
    # Apple refuses a token valid for more than an hour, and a short life keeps a leaked one cheap.
    assert claims["exp"] - claims["iat"] <= 3600


def test_a_transaction_apple_does_not_know_in_production_is_looked_for_in_sandbox(monkeypatch, apple):
    """There is no flag on a transaction id saying which environment it came from. You ask twice."""

    def handle(request):
        if request.url.host == "api.storekit.apple.com":
            return httpx.Response(404, json={"errorCode": 4040010, "errorMessage": "Transaction id not found."})
        return httpx.Response(200, json={"signedTransactionInfo": signed_transaction(environment="Sandbox")})

    seen = transport(monkeypatch, handle)
    receipt = stores.verify("app_store", "pro_monthly", "2000000800000001")

    assert [r.url.host for r in seen] == ["api.storekit.apple.com", "api.storekit-sandbox.apple.com"]
    assert receipt.environment == "sandbox"


def test_pinning_the_environment_to_production_never_asks_sandbox(monkeypatch, apple):
    """A deployment that must not honour a free sandbox purchase can say so once, in config."""
    apple.app_store_environment = "production"
    seen = transport(monkeypatch, lambda r: httpx.Response(404, json={"errorCode": 4040010, "errorMessage": "no"}))

    with pytest.raises(stores.ReceiptRefused):
        stores.verify("app_store", "pro_monthly", "2000000800000001")

    assert [r.url.host for r in seen] == ["api.storekit.apple.com"]


# --------------------------------------------------------------------------------------------
# Apple: the answers that are a no
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "over,reason",
    [
        ({"productId": "concierge_annual"}, "product_mismatch"),
        ({"bundleId": "com.someone.else"}, "wrong_app"),
        ({"revocationDate": 1_760_000_000_000}, "revoked"),
        ({"expiresDate": 1_600_000_000_000}, "expired"),
    ],
)
def test_a_real_receipt_for_the_wrong_thing_is_refused(monkeypatch, apple, over, reason):
    """Each of these exists at Apple. None of them entitles this member to pro_monthly."""
    transport(monkeypatch, lambda r: httpx.Response(200, json={"signedTransactionInfo": signed_transaction(**over)}))

    with pytest.raises(stores.ReceiptRefused) as exc:
        stores.verify("app_store", "pro_monthly", "2000000800000001")
    assert exc.value.reason == reason


def test_an_apple_outage_is_unavailable_and_not_a_refusal(monkeypatch, apple):
    """The distinction the member feels: their card may already have been charged."""
    transport(monkeypatch, lambda r: httpx.Response(500, json={"errorMessage": "Internal error"}))

    with pytest.raises(stores.ReceiptUnavailable):
        stores.verify("app_store", "pro_monthly", "2000000800000001")


def test_our_own_bad_credentials_are_unavailable_and_say_which_setting(monkeypatch, apple):
    """A 401 is our key, not their receipt, and the log has to say so or this costs an afternoon."""
    transport(monkeypatch, lambda r: httpx.Response(401, json={"errorMessage": "Unauthenticated"}))

    with pytest.raises(stores.ReceiptUnavailable) as exc:
        stores.verify("app_store", "pro_monthly", "2000000800000001")
    assert "MM_APP_STORE_KEY_ID" in exc.value.detail


def test_the_expiry_we_keep_is_apples_and_not_our_arithmetic(monkeypatch, apple):
    """A member on an introductory offer has a first period that our own addition would get wrong."""
    expires = datetime.now(timezone.utc) + timedelta(days=372)
    transport(
        monkeypatch,
        lambda r: httpx.Response(
            200, json={"signedTransactionInfo": signed_transaction(expiresDate=int(expires.timestamp() * 1000))}
        ),
    )

    receipt = stores.verify("app_store", "pro_monthly", "2000000800000001")
    assert abs((receipt.expires_at - expires).total_seconds()) < 1


# --------------------------------------------------------------------------------------------
# Apple: the key, however it survived the environment
# --------------------------------------------------------------------------------------------


def test_a_private_key_flattened_into_one_line_still_works(monkeypatch, apple, ec_key):
    """The usual way a .p8 arrives in an environment variable, and an unhelpful failure if unhandled."""
    apple.app_store_private_key = ec_key.replace("\n", "\\n")
    transport(monkeypatch, lambda r: httpx.Response(200, json={"signedTransactionInfo": signed_transaction()}))
    assert stores.verify("app_store", "pro_monthly", "2000000800000001").product_id == "pro_monthly"


def test_a_base64_private_key_still_works(monkeypatch, apple, ec_key):
    apple.app_store_private_key = base64.b64encode(ec_key.encode()).decode()
    transport(monkeypatch, lambda r: httpx.Response(200, json={"signedTransactionInfo": signed_transaction()}))
    assert stores.verify("app_store", "pro_monthly", "2000000800000001").product_id == "pro_monthly"


# --------------------------------------------------------------------------------------------
# Google Play
# --------------------------------------------------------------------------------------------


def test_the_play_request_mints_a_token_and_asks_subscriptionsv2(monkeypatch, play, rsa_public):
    seen = transport(monkeypatch, play_handler())

    receipt = stores.verify("play_store", "pro_monthly", "token-abc")

    token_request, get_request = seen[0], seen[1]
    assert token_request.url.host == "oauth2.googleapis.com"
    assertion = dict(pair.split("=", 1) for pair in token_request.content.decode().split("&"))["assertion"]
    claims = jwt.decode(assertion, rsa_public, algorithms=["RS256"], audience="https://oauth2.googleapis.com/token")
    assert claims["scope"] == "https://www.googleapis.com/auth/androidpublisher"
    assert claims["iss"] == "lovera-eas-submit@lovera.iam.gserviceaccount.com"

    assert get_request.url.host == "androidpublisher.googleapis.com"
    assert get_request.url.path == (
        f"/androidpublisher/v3/applications/{BUNDLE_ID}/purchases/subscriptionsv2/tokens/token-abc"
    )
    assert get_request.headers["Authorization"] == "Bearer ya29.test"
    assert receipt.auto_renewing is True


def test_the_access_token_is_reused_rather_than_minted_per_purchase(monkeypatch, play):
    seen = transport(monkeypatch, play_handler())

    stores.verify("play_store", "pro_monthly", "token-abc")
    stores.verify("play_store", "pro_monthly", "token-def")

    assert sum(1 for r in seen if r.url.host == "oauth2.googleapis.com") == 1


@pytest.mark.parametrize(
    "state",
    [
        "SUBSCRIPTION_STATE_CANCELED",
        "SUBSCRIPTION_STATE_EXPIRED",
        "SUBSCRIPTION_STATE_ON_HOLD",
        "SUBSCRIPTION_STATE_PAUSED",
        "SUBSCRIPTION_STATE_PENDING",
    ],
)
def test_only_an_active_or_grace_subscription_is_honoured(monkeypatch, play, state):
    transport(monkeypatch, play_handler(play_subscription(subscriptionState=state)))

    with pytest.raises(stores.ReceiptRefused) as exc:
        stores.verify("play_store", "pro_monthly", "token-abc")
    assert exc.value.reason == "not_active"


def test_a_subscription_in_grace_keeps_its_entitlement(monkeypatch, play):
    """Their renewal payment failed and Google is retrying. They have not done anything wrong."""
    transport(monkeypatch, play_handler(play_subscription(subscriptionState="SUBSCRIPTION_STATE_IN_GRACE_PERIOD")))
    assert stores.verify("play_store", "pro_monthly", "token-abc").product_id == "pro_monthly"


def test_a_purchase_of_a_different_product_is_refused(monkeypatch, play):
    body = play_subscription()
    body["lineItems"][0]["productId"] = "concierge_annual"
    transport(monkeypatch, play_handler(body))

    with pytest.raises(stores.ReceiptRefused) as exc:
        stores.verify("play_store", "pro_monthly", "token-abc")
    assert exc.value.reason == "product_mismatch"


def test_an_unacknowledged_purchase_is_acknowledged(monkeypatch, play):
    """Google refunds and revokes anything unacknowledged after three days.

    The symptom of getting this wrong is churn with no cancellations, which looks nothing like
    its cause, so it is pinned here rather than left to be noticed in a revenue report.
    """
    seen = transport(
        monkeypatch, play_handler(play_subscription(acknowledgementState="ACKNOWLEDGEMENT_STATE_PENDING"))
    )

    stores.verify("play_store", "pro_monthly", "token-abc")

    acks = [r for r in seen if r.url.path.endswith(":acknowledge")]
    assert len(acks) == 1
    assert acks[0].method == "POST"
    assert acks[0].url.path == (
        f"/androidpublisher/v3/applications/{BUNDLE_ID}/purchases/subscriptions/pro_monthly/tokens/token-abc:acknowledge"
    )


def test_an_already_acknowledged_purchase_is_not_acknowledged_again(monkeypatch, play):
    seen = transport(monkeypatch, play_handler())
    stores.verify("play_store", "pro_monthly", "token-abc")
    assert not [r for r in seen if r.url.path.endswith(":acknowledge")]


def test_a_failed_acknowledge_still_grants_the_purchase(monkeypatch, play):
    """They paid and Google says it is active. Withholding what they bought helps nobody."""
    transport(
        monkeypatch,
        play_handler(play_subscription(acknowledgementState="ACKNOWLEDGEMENT_STATE_PENDING"), ack_status=503),
    )
    assert stores.verify("play_store", "pro_monthly", "token-abc").product_id == "pro_monthly"


def test_a_play_permission_error_names_the_permissions_it_needs(monkeypatch, play):
    """The most likely setup failure, and the Play Console does not explain it when it happens."""
    transport(monkeypatch, play_handler(get_status=403))

    with pytest.raises(stores.ReceiptUnavailable) as exc:
        stores.verify("play_store", "pro_monthly", "token-abc")
    assert "Release apps to testing tracks" in exc.value.detail


def test_a_test_purchase_is_reported_as_sandbox(monkeypatch, play):
    transport(monkeypatch, play_handler(play_subscription(testPurchase={})))
    assert stores.verify("play_store", "pro_monthly", "token-abc").environment == "sandbox"


def test_googles_nanosecond_timestamps_parse(monkeypatch, play):
    """`fromisoformat` will not take nine fractional digits, and Google sends them."""
    body = play_subscription()
    body["lineItems"][0]["expiryTime"] = "2027-03-01T08:30:00.123456789Z"
    transport(monkeypatch, play_handler(body))

    receipt = stores.verify("play_store", "pro_monthly", "token-abc")
    assert receipt.expires_at == datetime(2027, 3, 1, 8, 30, 0, 123456, tzinfo=timezone.utc)


# --------------------------------------------------------------------------------------------
# Configuration: choosing a mode is not the same as being able to use it
# --------------------------------------------------------------------------------------------


def test_a_mode_with_no_credentials_reports_the_store_as_off(monkeypatch):
    """So the phone draws no purchase UI, rather than a button that charges and then fails."""
    from app.modules.billing import service

    settings = config.get_settings()
    monkeypatch.setattr(settings, "store_validation", "app_store", raising=False)
    monkeypatch.setattr(settings, "app_store_issuer_id", None, raising=False)
    monkeypatch.setattr(settings, "app_store_key_id", None, raising=False)
    monkeypatch.setattr(settings, "app_store_private_key", None, raising=False)

    status = service.store_status()
    assert status["enabled"] is False
    assert "MM_APP_STORE_ISSUER_ID" in status["reason"]


def test_a_fully_configured_mode_reports_the_store_as_on(apple):
    from app.modules.billing import service

    status = service.store_status()
    assert status["enabled"] is True
    assert status["reason"] is None


def test_an_unreadable_play_key_is_reported_rather_than_raised(monkeypatch):
    settings = config.get_settings()
    monkeypatch.setattr(settings, "play_service_account_json", "this is not json", raising=False)
    assert "cannot be read" in stores.missing_configuration("play_store")


# --------------------------------------------------------------------------------------------
# End to end, through the endpoint
# --------------------------------------------------------------------------------------------


def test_a_verified_purchase_activates_the_plan_the_store_confirmed(client, monkeypatch, apple):
    transport(monkeypatch, lambda r: httpx.Response(200, json={"signedTransactionInfo": signed_transaction()}))
    a = member(client, "store-ok")

    r = a.post(
        "/subscriptions/store-purchase",
        json={"store": "app_store", "product_id": "pro_monthly", "transaction_id": uuid.uuid4().hex},
    )

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "granted"
    assert r.json()["entitlements"]["plan"] == "pro"


def test_a_refused_receipt_grants_nothing_and_is_written_down(client, monkeypatch, apple):
    transport(
        monkeypatch,
        lambda r: httpx.Response(200, json={"signedTransactionInfo": signed_transaction(revocationDate=1_700_000_000_000)}),
    )
    a = member(client, "store-revoked")

    r = a.post(
        "/subscriptions/store-purchase",
        json={"store": "app_store", "product_id": "pro_monthly", "transaction_id": uuid.uuid4().hex},
    )

    assert r.status_code == 422, r.text
    assert a.get("/subscriptions/current").json()["entitlements"]["plan"] == "free"


def test_an_outage_tells_the_member_their_money_is_safe(client, monkeypatch, apple):
    """Not "that failed" — the store may have taken the money, and only the store can give it back."""
    transport(monkeypatch, lambda r: httpx.Response(503, json={"errorMessage": "down"}))
    a = member(client, "store-outage")

    r = a.post(
        "/subscriptions/store-purchase",
        json={"store": "app_store", "product_id": "pro_monthly", "transaction_id": uuid.uuid4().hex},
    )

    # 503, not 422: "we could not check" is a different answer from "that is not valid", and the
    # member's next move differs too.
    assert r.status_code == 503, r.text
    assert a.get("/subscriptions/current").json()["entitlements"]["plan"] == "free"


def test_a_receipt_from_the_other_store_is_refused(client, monkeypatch, apple):
    """An Android receipt arriving at a deployment that can only check Apple is unverifiable."""
    transport(monkeypatch, lambda r: httpx.Response(200, json={}))
    a = member(client, "store-crossed")

    r = a.post(
        "/subscriptions/store-purchase",
        json={"store": "play_store", "product_id": "pro_monthly", "transaction_id": uuid.uuid4().hex},
    )

    assert r.status_code == 422, r.text
    assert a.get("/subscriptions/current").json()["entitlements"]["plan"] == "free"


def test_a_sandbox_receipt_is_refused_in_production(client, monkeypatch, apple):
    """The whole point of verification. A sandbox purchase is free to make."""
    # Sign in first: production also switches off `expose_dev_otp`, so the test helper could not
    # read the code back afterwards.
    a = member(client, "store-sandbox")
    monkeypatch.setattr(config.get_settings(), "env", "production", raising=False)
    transport(
        monkeypatch,
        lambda r: httpx.Response(200, json={"signedTransactionInfo": signed_transaction(environment="Sandbox")}),
    )

    r = a.post(
        "/subscriptions/store-purchase",
        json={"store": "app_store", "product_id": "pro_monthly", "transaction_id": uuid.uuid4().hex},
    )

    assert r.status_code == 422, r.text
    assert a.get("/subscriptions/current").json()["entitlements"]["plan"] == "free"


def test_a_refused_receipt_replayed_is_still_refused(client, monkeypatch, apple):
    """The refusal row has to dedupe too, or a retry loop re-asks Apple about a dead receipt forever."""
    transport(
        monkeypatch,
        lambda r: httpx.Response(200, json={"signedTransactionInfo": signed_transaction(expiresDate=1_600_000_000_000)}),
    )
    a = member(client, "store-replay")
    body = {"store": "app_store", "product_id": "pro_monthly", "transaction_id": uuid.uuid4().hex}

    assert a.post("/subscriptions/store-purchase", json=body).status_code == 422
    second = a.post("/subscriptions/store-purchase", json=body)
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["status"] == "refused_expired"
    assert a.get("/subscriptions/current").json()["entitlements"]["plan"] == "free"
