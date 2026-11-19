"""Attribution must not change sign-in or expose a small member cohort to staff."""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app.catalog.campaigns import CAMPAIGNS
from app.core.analytics import AnalyticsPropertyError, anon_key, track
from app.core.db import session_factory
from app.models.account import Member
from app.models.privacy import AnalyticsEvent, AuditEvent
from app.modules.account import service as account
from app.modules.admin import acquisition
from tests.conftest import Actor, staff, unique_email


def sign_in(client, email=None, **extra) -> Actor:
    actor = Actor(client, email or unique_email("acquisition"))
    challenge = client.post("/v1/auth/start", json={"email": actor.email}).json()
    response = client.post("/v1/auth/verify", json={
        "challenge_id": challenge["challenge_id"], "code": challenge["dev_code"],
        "device_id": "test-device", **extra,
    })
    assert response.status_code == 200, response.text
    actor.token = response.json()["access_token"]
    actor.refresh = response.json()["refresh_token"]
    actor.id = actor.get("/me").json()["id"]
    return actor


def signup_events(actor):
    with session_factory()() as db:
        return db.execute(select(AnalyticsEvent).where(
            AnalyticsEvent.event == "account_created", AnalyticsEvent.anon_member_key == anon_key(actor.id),
        )).scalars().all()


def test_old_clients_still_sign_in_without_campaign_fields(client):
    actor = sign_in(client)
    events = signup_events(actor)
    assert len(events) == 1
    assert events[0].properties == {"locale": "en", "market": "rome", "acquisition_channel": "direct"}
    assert actor.get("/me").json()["roles"] == ["member"]


def test_only_server_catalog_values_are_recorded_and_sign_in_does_not_overwrite_them(client):
    actor = sign_in(client, campaign_code="rome-instagram", campaign_source="a-persons-name", utm_source="https://private.example/")
    first = signup_events(actor)[0]
    assert first.properties["campaign_code"] == "rome-instagram"
    assert first.properties["campaign_source"] == "instagram"
    assert first.properties["acquisition_channel"] == "direct"
    again = sign_in(client, actor.email, campaign_code="rome-partners")
    assert again.id == actor.id
    after = signup_events(actor)
    assert len(after) == 1 and after[0].id == first.id and after[0].properties == first.properties
    assert actor.get("/me").json()["capabilities"]["plan"] == "free"


@pytest.mark.parametrize("code", ["some-members-name", "https://example.test/private", "", "x" * 64])
def test_unregistered_campaigns_are_discarded_without_blocking_sign_in(client, code):
    actor = sign_in(client, campaign_code=code)
    assert "campaign_code" not in signup_events(actor)[0].properties
    assert "campaign_source" not in signup_events(actor)[0].properties


def test_campaign_input_is_bounded_without_consuming_the_login_challenge(client):
    challenge = client.post("/v1/auth/start", json={"email": unique_email("campaign-long")}).json()
    body = {"challenge_id": challenge["challenge_id"], "code": challenge["dev_code"], "campaign_code": "x" * 65}
    assert client.post("/v1/auth/verify", json=body).status_code == 422
    body.pop("campaign_code")
    assert client.post("/v1/auth/verify", json=body).status_code == 200


def test_existing_invite_and_locale_service_arguments_keep_their_meaning(client):
    with session_factory()() as db:
        challenge, code = account.start_challenge(db, unique_email("invited"))
        member, _, _, _ = account.verify_challenge(db, challenge.id, code, None, "invite-fixture", "it", "rome-community")
        db.flush()
        event = db.execute(select(AnalyticsEvent).where(AnalyticsEvent.anon_member_key == anon_key(member.id), AnalyticsEvent.event == "account_created")).scalar_one()
        assert member.invite_code == "invite-fixture" and member.locale == "it"
        assert event.properties["acquisition_channel"] == "invite"
        assert event.properties["campaign_source"] == "community"
        db.commit()


def test_analytics_allowlist_rejects_unreviewed_attribution_values():
    with pytest.raises(AnalyticsPropertyError):
        track(None, "account_created", "unused", campaign_code="a-person", campaign_source="instagram")
    with pytest.raises(AnalyticsPropertyError):
        track(None, "account_created", "unused", campaign_code="rome-instagram", campaign_source="a-person")
    with pytest.raises(AnalyticsPropertyError):
        track(None, "account_created", "unused", campaign_source="instagram")


@pytest.fixture
def cohort_data(client, monkeypatch):
    """Use a future clock and explicitly dated rows so other suites' members cannot affect counts."""
    end = datetime(2032, 5, 31, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(acquisition, "utcnow", lambda: end)
    ids = []
    event_keys = set()
    with session_factory()() as db:
        def member(campaign="rome-instagram", *, age_days=2, roles=None, channel="direct"):
            email = unique_email("report-cohort")
            row = Member(email=email, email_hash=hashlib.sha256(email.encode()).hexdigest(), roles=roles or ["member"])
            db.add(row)
            db.flush()
            ids.append(row.id)
            properties = {"acquisition_channel": channel}
            if campaign is not None:
                properties["campaign_code"] = campaign
            event(row.id, "account_created", end - timedelta(days=age_days), **properties)
            return row.id

        def event(member_id, name, at=None, **properties):
            key = anon_key(member_id)
            event_keys.add(key)
            db.add(AnalyticsEvent(event=name, anon_member_key=key, properties=properties, occurred_at=at or end - timedelta(hours=1)))

        yield end, db, member, event
        db.rollback()
        if event_keys:
            db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.anon_member_key.in_(event_keys)))
        if ids:
            db.execute(delete(Member).where(Member.id.in_(ids)))
        db.commit()


def cohort(body, code="rome-instagram", source=None):
    return next(row for row in body["cohorts"] if row["campaign_code"] == code and (source is None or row["source"] == source))


def test_report_counts_distinct_members_from_first_signup_and_only_successful_verification(client, cohort_data):
    end, db, member, event = cohort_data
    members = [member() for _ in range(10)]
    for index, member_id in enumerate(members):
        # Both repeated profile edits and repeated signup telemetry count once. A later placement
        # must not move the member to another acquisition cohort.
        event(member_id, "account_created", campaign_code="rome-partners")
        for _ in range(3):
            event(member_id, "profile_completed", completion_categories=["name", "bio", "prompts"])
            event(member_id, "verification_completed", status="verified" if index < 5 else "failed")
            if index < 5:
                event(member_id, "blueprint_confirmed", version=1)
        if index >= 5:
            event(member_id, "verification_completed", status="review_required")
            event(member_id, "verification_completed", end + timedelta(days=1), status="verified")
            event(member_id, "blueprint_confirmed", end - timedelta(days=3), version=1)

    old = member(age_days=31)
    event(old, "account_created", campaign_code="rome-instagram")
    event(old, "profile_completed")
    member(age_days=-1)  # A future signup is not in the cohort.
    reviewer = member(roles=["member", "safety_reviewer"])
    event(reviewer, "verification_completed", status="verified")
    event("not-a-signup", "profile_completed")
    db.commit()

    admin = staff(client, "admin@example.test")
    response = admin.get("/admin/acquisition?days=30")
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "private, no-store"
    row = cohort(response.json())
    assert {key: row[key] for key in ("signups", *acquisition.STAGES)} == {
        "signups": 10, "verification_completed": 5, "blueprint_confirmed": 5, "profile_completed": 10,
    }
    assert cohort(response.json(), "rome-partners")["signups"] is None
    audit = db.execute(select(AuditEvent).where(AuditEvent.action == "admin.acquisition_viewed", AuditEvent.actor_id == admin.id).order_by(AuditEvent.occurred_at.desc()).limit(1)).scalar_one()
    assert audit.redacted_metadata == {"days": 30}
    assert audit.purpose == "acquisition_review" and audit.request_id


def test_report_hides_small_cells_and_complements_and_only_returns_fixed_labels(client, cohort_data):
    _, db, member, event = cohort_data
    for _ in range(4):
        event(member("rome-instagram"), "profile_completed")
    six = [member("rome-community") for _ in range(6)]
    for member_id in six[:5]:
        event(member_id, "verification_completed", status="verified")
    for member_id in six:
        event(member_id, "profile_completed")
    for _ in range(5):
        member("a-historical-private-name")
    db.commit()

    body = staff(client, "admin@example.test").get("/admin/acquisition").json()
    assert all(cohort(body)[key] is None for key in ("signups", *acquisition.STAGES))
    row = cohort(body, "rome-community")
    assert row["signups"] == 6 and row["verification_completed"] is None and row["profile_completed"] == 6
    assert cohort(body, None, "direct")["signups"] == 5
    assert cohort(body, None, "invite")["signups"] is None
    assert len(body["cohorts"]) == len(CAMPAIGNS) + 2
    assert set(body) == {"days", "window_start", "window_end", "minimum_cohort_size", "campaigns", "cohorts"}
    assert all(set(row) == {"campaign_code", "source", "label", "signups", *acquisition.STAGES} for row in body["cohorts"])
    assert "a-historical-private-name" not in str(body)
    assert all(member_id not in str(body) and anon_key(member_id) not in str(body) for member_id in six)


def test_report_window_uses_signup_time_not_later_progress(client, cohort_data):
    _, db, member, _ = cohort_data
    for age in (6, 29, 89):
        for _ in range(5):
            member(age_days=age)
    db.commit()
    admin = staff(client, "admin@example.test")
    for days, expected in ((7, 5), (30, 10), (90, 15)):
        response = admin.get(f"/admin/acquisition?days={days}")
        assert response.status_code == 200, response.text
        assert response.json()["days"] == days
        assert cohort(response.json())["signups"] == expected


def test_acquisition_is_admin_only_and_validates_window(client):
    assert client.get("/v1/admin/acquisition").status_code == 401
    actor = sign_in(client)
    for roles in (["member"], ["member", "concierge"], ["member", "support"], ["member", "safety_reviewer"]):
        with session_factory()() as db:
            db.get(Member, actor.id).roles = roles
            db.commit()
        assert actor.get("/admin/acquisition").status_code == 403
    admin = staff(client, "admin@example.test")
    for days in ("1", "8", "31", "91", "text"):
        assert admin.get(f"/admin/acquisition?days={days}").status_code == 422


def test_member_export_includes_own_approved_attribution_and_erasure_removes_linked_analytics(client):
    from app.jobs import erase_member

    actor = sign_in(client, campaign_code="rome-instagram")
    other = sign_in(client, campaign_code="rome-partners")
    export_request = actor.post("/me/export")
    assert export_request.status_code == 202
    exported = actor.get(export_request.json()["download_path"].removeprefix("/v1")).json()
    assert exported["acquisition"]["campaign_code"] == "rome-instagram"
    assert exported["acquisition"]["source"] == "instagram"
    assert exported["acquisition"]["channel"] == "direct"
    assert anon_key(actor.id) not in str(exported["acquisition"])
    assert "rome-partners" not in str(exported["acquisition"])
    with session_factory()() as db:
        assert len(db.execute(select(AnalyticsEvent).where(AnalyticsEvent.anon_member_key == anon_key(actor.id))).scalars().all()) >= 2
        erase_member(db, db.get(Member, actor.id))
        db.commit()
        assert db.execute(select(AnalyticsEvent.id).where(AnalyticsEvent.anon_member_key == anon_key(actor.id))).first() is None
        assert db.execute(select(AnalyticsEvent.id).where(AnalyticsEvent.anon_member_key == anon_key(other.id))).first() is not None
