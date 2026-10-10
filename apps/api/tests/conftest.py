from __future__ import annotations

import os
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MM_DATABASE_URL", "postgresql+psycopg://postgres@/matchmaker_test?host=/tmp&port=5433")
os.environ.setdefault("MM_ENV", "test")

from app.core.config import get_settings  # noqa: E402
from app.core.db import get_engine, reset_engine  # noqa: E402
from app.models import Base  # noqa: E402


@pytest.fixture(scope="session")
def app():
    get_settings.cache_clear()
    reset_engine()
    from app.main import app as fastapi_app

    Base.metadata.drop_all(get_engine())
    Base.metadata.create_all(get_engine())
    return fastapi_app


@pytest.fixture(scope="session")
def client(app):
    with TestClient(app) as c:
        yield c


class Actor:
    """A member identity bound to a TestClient."""

    def __init__(self, client: TestClient, email: str):
        self.client = client
        self.email = email
        self.token: str | None = None
        self.refresh: str | None = None
        self.id: str | None = None

    def headers(self, **extra):
        h = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        h.update(extra)
        return h

    def get(self, path, **kw):
        return self.client.get(f"/v1{path}", headers=self.headers(**kw.pop("headers", {})), **kw)

    def post(self, path, json=None, **kw):
        return self.client.post(f"/v1{path}", json=json, headers=self.headers(**kw.pop("headers", {})), **kw)

    def put(self, path, json=None, **kw):
        return self.client.put(f"/v1{path}", json=json, headers=self.headers(**kw.pop("headers", {})), **kw)

    def patch(self, path, json=None, **kw):
        return self.client.patch(f"/v1{path}", json=json, headers=self.headers(**kw.pop("headers", {})), **kw)

    def delete(self, path, **kw):
        return self.client.delete(f"/v1{path}", headers=self.headers(**kw.pop("headers", {})), **kw)

    def sign_in(self):
        r = self.client.post("/v1/auth/start", json={"email": self.email})
        assert r.status_code == 200, r.text
        body = r.json()
        r = self.client.post("/v1/auth/verify", json={"challenge_id": body["challenge_id"], "code": body["dev_code"], "device_id": "test-device"})
        assert r.status_code == 200, r.text
        self.token = r.json()["access_token"]
        self.refresh = r.json()["refresh_token"]
        me = self.get("/me")
        assert me.status_code == 200, me.text
        self.id = me.json()["id"]
        return me.json()


def unique_email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.test"


def onboard(actor: Actor, *, gender: str, seeking: list[str], zone: str = "rome:centro", birth_year: int = 1992, name: str = "Alex", windows=None, children: str = "open", children_pref=None, children_tier: str = "must", languages=None, faith_consent: bool = False, weekend: str = "calm", social: str = "balanced", conflict: str = "talk_now", contact: str = "few_times_week", planning: str = "mixed", affection: str = "moderate", family: str = "close", drinking: str = "socially", city: str = "rome", intent: str = "long_term", distance: int = 25):
    """Drive a member through the full onboarding via the public API."""
    actor.sign_in()
    r = actor.post("/me/adult-consent", json={"birth_date": date(birth_year, 5, 4).isoformat(), "accept_terms": True, "accept_privacy": True, "accept_community": True, "ai_processing_consent": True, "special_category_consent": faith_consent})
    assert r.status_code == 200, r.text
    r = actor.post("/verification/sessions")
    assert r.status_code == 200, r.text
    ref = r.json()["session"]["provider_ref"]
    r = actor.post("/verification/sandbox/complete", json={"provider_ref": ref, "outcome": "verified"})
    assert r.status_code == 200 and r.json()["status"] == "verified", r.text
    r = actor.post("/me/intent", json={"intent": intent, "home_city_id": city, "home_zone_id": zone, "gender": gender, "seeking": seeking, "max_distance_km": distance})
    assert r.status_code == 200, r.text
    assert r.json()["onboarding_step"] == "blueprint", r.json()
    # Blueprint interview
    r = actor.post("/blueprint/sessions", json={"mode": "initial"})
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    answers = {
        "children": {"choice": children, "tier": children_tier, "partner_values": children_pref or [children, "open"]},
        "relationship_structure": {"choice": "monogamous", "tier": "must", "partner_values": ["monogamous"]},
        "age_range": {"range": {"min": 25, "max": 45}},
        "distance": {"range": {"value": distance}},
        "marriage": {"choice": "open", "tier": "open", "partner_values": ["important", "open", "not_important"]},
        "smoking": {"choice": "never", "tier": "prefer", "partner_values": ["never", "socially"]},
        "relocation": {"choice": "maybe", "tier": "open", "partner_values": ["open", "maybe", "no"]},
        "faith": {"skip": True},
        "weekend": {"choice": weekend},
        "weeknight_party": {"choice": social},
        "conflict": {"choice": conflict},
        "contact": {"choice": contact},
        "spontaneous_trip": {"choice": planning},
        "affection": {"choice": affection},
        "family": {"choice": family},
        "movement": {"choice": "moderate"},
        "bonus": {"choice": "balanced"},
        "career": {"choice": "balanced"},
        "drinking": {"choice": drinking, "tier": "open", "partner_values": ["never", "socially"]},
        "pets": {"choice": "none"},
        "sleep": {"choice": "flexible"},
        "readiness": {"choice": "14"},
    }
    state = r.json()
    for _ in range(30):
        q = state["next_question"]
        if q is None:
            break
        payload = {"question_key": q["key"], **answers[q["key"]]}
        r = actor.post(f"/blueprint/sessions/{sid}/answers", json=payload)
        assert r.status_code == 200, r.text
        state = r.json()
    r = actor.get(f"/blueprint/sessions/{sid}/review")
    assert r.status_code == 200, r.text
    r = actor.post("/blueprint/confirm", json={"session_id": sid})
    assert r.status_code == 200, r.text
    assert r.json()["onboarding_step"] == "profile", r.json()
    r = actor.patch("/profile", json={"display_name": name, "bio": "I like slow mornings, long lunches and honest conversations about the future.", "languages": languages or ["en", "it"], "prompts": [{"key": "second_date", "answer": "Something outdoors with good coffee."}, {"key": "repair", "answer": "Say what I felt, then listen."}]})
    assert r.status_code == 200, r.text
    r = actor.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 1200, "checksum": "abc"})
    assert r.status_code == 201, r.text
    mid = r.json()["media"]["id"]
    r = actor.post(f"/profile/media/{mid}/complete", json={"checksum": "abc", "data_url": "data:image/jpeg;base64,/9j/4AAQ"})
    assert r.status_code == 200, r.text
    r = actor.put("/availability", json={"recurring_windows": windows or [{"weekday": 3, "start": "18:00", "end": "22:00"}, {"weekday": 5, "start": "10:00", "end": "16:00"}], "date_styles": ["coffee", "walk"], "date_ready": True})
    assert r.status_code == 200, r.text
    me = actor.get("/me").json()
    assert me["status"] == "active", me
    return me


def subscribe(actor: Actor, plan: str = "pro", cadence: str = "monthly"):
    r = actor.post("/subscriptions/checkout", json={"plan": plan, "cadence": cadence}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 200, r.text
    ref = r.json()["provider_ref"]
    r = actor.post("/subscriptions/sandbox/pay", json={"checkout_ref": ref, "outcome": "paid"})
    assert r.status_code == 200, r.text
    assert r.json()["entitlements"]["plan"] == plan


_staff_cache: dict[str, Actor] = {}


def staff(client: TestClient, email: str) -> Actor:
    """Staff accounts sign in once per test session (the auth endpoint is rate limited)."""
    key = f"{id(client)}:{email}"
    if key not in _staff_cache:
        a = Actor(client, email)
        a.sign_in()
        _staff_cache[key] = a
    return _staff_cache[key]


def mutual_pair(client: TestClient, prefix: str = "pair") -> tuple[Actor, Actor, str]:
    """Two onboarded members, matched and both accepting: the state a conversation needs.

    Shared because more than one suite needs to get to a real conversation, and reaching one through
    the public API is a dozen steps that are easy to get subtly wrong — a pair that is introduced but
    not mutual has no conversation at all, and a test built on that asserts nothing.
    """
    a = Actor(client, unique_email(f"{prefix}-a"))
    b = Actor(client, unique_email(f"{prefix}-b"))
    onboard(a, gender="woman", seeking=["man"], name="Ada", zone="rome:prati")
    onboard(b, gender="man", seeking=["woman"], name="Bo", zone="rome:centro", birth_year=1990)
    subscribe(a)
    subscribe(b)
    concierge = staff(client, "concierge@example.test")
    r = concierge.post("/admin/matching/runs", json={"market_id": "rome", "auto_publish": True})
    assert r.status_code == 201, r.text

    intro = next(
        (i for i in a.get("/introductions").json()["current"] if i["profile"] and i["profile"]["member_id"] == b.id),
        None,
    )
    assert intro, "the pair has to be introduced before there is anything to read"
    for who in (a, b):
        r = who.post(f"/introductions/{intro['id']}/decision", json={"decision": "accept"}, headers={"Idempotency-Key": str(uuid.uuid4())})
        assert r.status_code == 202, r.text
    conv_id = r.json()["conversation_id"]
    assert conv_id, "both accepting is what opens the conversation"
    return a, b, conv_id
