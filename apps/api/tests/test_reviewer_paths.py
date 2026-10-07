"""What a reviewer can actually do with what a member sent them.

Two promises the product made and could not keep. A reporter who attached a screenshot was told
it was kept "with restricted access; every access is audited" — true of the row, false of the
product: no endpoint could read the bytes back, so the one thing most reports turn on could be
opened by nobody. And a member who disputed an inference without being able to say what the right
answer was was told it had been "noted for a reviewer": the row was readable, but past the newest
fifty there was no offset and no way to mark one dealt with, so the queue could not drain and the
oldest disputes were permanently out of reach while still affecting matching.
"""
from __future__ import annotations

from tests.conftest import Actor, onboard, staff, unique_email

# Barcelona for the same reason the consent tests use it: these members would otherwise join the
# pool the journey tests allocate from and change who is paired with whom.
CITY = "barcelona"
ZONE = "barcelona:gracia"

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="


def _report_with_evidence(client) -> tuple[Actor, str, str]:
    reporter = Actor(client, unique_email("rosa-report"))
    subject = Actor(client, unique_email("sal-subject"))
    onboard(reporter, gender="woman", seeking=["man"], name="Rosa", city=CITY, zone=ZONE)
    onboard(subject, gender="man", seeking=["woman"], name="Sal", city=CITY, zone=ZONE)

    r = reporter.post("/safety/reports", json={"subject_id": subject.id, "category": "harassment", "urgency": "recent", "narrative": "Screenshot attached.", "block_now": False})
    assert r.status_code == 201, r.text
    report_id = r.json()["id"]

    r = reporter.post(f"/safety/reports/{report_id}/evidence", json={"content_type": "image/png", "size_bytes": 68, "description": "What he sent me.", "data_url": PNG})
    assert r.status_code == 201, r.text
    return reporter, report_id, r.json()["evidence_id"]


def test_a_reviewer_can_open_the_evidence_a_reporter_attached(client):
    _, report_id, evidence_id = _report_with_evidence(client)
    reviewer = staff(client, "safety@example.test")

    case = reviewer.get(f"/admin/safety/cases/{report_id}?purpose=case_review")
    assert case.status_code == 200, case.text
    listed = next(e for e in case.json()["evidence"] if e["id"] == evidence_id)
    before = listed["access_count"]

    r = reviewer.get(f"/admin/safety/evidence/{evidence_id}?purpose=case_review")
    assert r.status_code == 200, r.text
    body = r.json()
    # The bytes, unchanged: the reviewer sees what the reporter sent, not a description of it.
    assert body["data_url"] == PNG
    assert body["content_type"] == "image/png"
    assert body["description"] == "What he sent me."
    assert body["access_count"] == before + 1

    # And the access is in the audit trail against the declared purpose, which is what the reporter
    # was promised at the moment they uploaded it.
    from sqlalchemy import select

    from app.core.db import session_factory
    from app.models.privacy import AuditEvent

    db = session_factory()()
    try:
        rows = db.execute(select(AuditEvent).where(AuditEvent.resource_type == "safety_evidence", AuditEvent.resource_id == evidence_id)).scalars().all()
    finally:
        db.close()
    assert [e.action for e in rows] == ["admin.evidence_opened"]
    assert rows[0].purpose == "case_review"


def test_evidence_is_not_readable_without_a_reviewer_role_or_a_purpose(client):
    reporter, _, evidence_id = _report_with_evidence(client)

    # The member who uploaded it is not staff. This endpoint is the reviewer's, and a member
    # reading their own case has `GET /safety/cases/{id}` for that.
    assert reporter.get(f"/admin/safety/evidence/{evidence_id}?purpose=case_review").status_code == 403

    reviewer = staff(client, "safety@example.test")
    # No purpose at all: the audit row would name nothing, so there is nothing to answer with.
    assert reviewer.get(f"/admin/safety/evidence/{evidence_id}").status_code == 422
    assert reviewer.get("/admin/safety/evidence/does-not-exist?purpose=case_review").status_code == 404


def test_evidence_has_to_be_the_file_and_not_a_link_to_one(client):
    """The one that is not a usability bug.

    `EvidenceIn.data_url` was a string, stored unread beside a `content_type` the member also
    supplied, and the reviewer page hands what is stored to an `<img>`. So a reporter could skip the
    picker and upload `https://attacker.example/beacon.png` as an `image/png`: when the reviewer
    opened the case about them, their browser would fetch it and tell the person being reported
    their address, their user agent and the moment the case was opened — from inside the workflow
    that exists to protect people from them.
    """
    reporter = Actor(client, unique_email("rita-evidence"))
    subject = Actor(client, unique_email("sid-evidence"))
    onboard(reporter, gender="woman", seeking=["man"], name="Rita", city=CITY, zone=ZONE)
    onboard(subject, gender="man", seeking=["woman"], name="Sid", city=CITY, zone=ZONE)
    report_id = reporter.post("/safety/reports", json={"subject_id": subject.id, "category": "harassment", "urgency": "recent", "block_now": False}).json()["id"]

    def upload(**kw):
        return reporter.post(f"/safety/reports/{report_id}/evidence", json={"content_type": "image/png", **kw})

    # A link to somewhere else, which is the attack.
    assert upload(data_url="https://attacker.example/beacon.png").status_code == 422
    assert upload(data_url="//attacker.example/beacon.png").status_code == 422
    # A type the upload does not admit to.
    assert upload(data_url="data:text/html;base64,PGltZyBzcmM9eD4=").status_code == 422
    # A type we do not accept at all, honestly declared.
    assert upload(content_type="text/html", data_url="data:text/html;base64,PGltZyBzcmM9eD4=").status_code == 422
    # An honest header over bytes that are not a PNG: HTML served to a reviewer as an image is a
    # different problem from a beacon, and the signature settles it.
    assert upload(data_url="data:image/png;base64,PGltZyBzcmM9eD4=").status_code == 422
    # Not base64 at all.
    assert upload(data_url="data:image/png;base64,not base64 at all!").status_code == 422
    # And the real thing still goes through.
    assert upload(data_url=PNG).status_code == 201


def test_profile_media_has_the_same_check(client):
    """Because the first version of this fix would have put it on evidence alone.

    `complete_media` took the same unchecked string, and profile media is served to other members —
    so one member could make another member's browser fetch a URL of their choosing. Same validator,
    same refusal, a different allow-list: a photo is an image and a voice note is audio.
    """
    a = Actor(client, unique_email("ana-media"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", city=CITY, zone=ZONE)
    created = a.post("/profile/media", json={"type": "photo", "content_type": "image/png", "size_bytes": 68, "checksum": None, "alt_text": "Me"})
    assert created.status_code == 201, created.text
    media_id = created.json()["media"]["id"]

    assert a.post(f"/profile/media/{media_id}/complete", json={"data_url": "https://attacker.example/beacon.png"}).status_code == 422
    assert a.post(f"/profile/media/{media_id}/complete", json={"data_url": "data:text/html;base64,PGk+"}).status_code == 422
    assert a.post(f"/profile/media/{media_id}/complete", json={"data_url": PNG}).status_code == 200
    # An audio data URL on a photo is refused, and on a voice note it is not: the allow-list is per
    # kind rather than one list that has to contain everything.
    voice = a.post("/profile/media", json={"type": "voice", "content_type": "audio/mpeg", "size_bytes": 10, "checksum": None, "alt_text": None}).json()["media"]["id"]
    assert a.post(f"/profile/media/{media_id}/complete", json={"data_url": "data:audio/mpeg;base64,SUQzAwAA"}).status_code == 422
    assert a.post(f"/profile/media/{voice}/complete", json={"data_url": "data:audio/mpeg;base64,SUQzAwAA"}).status_code == 200


def _correction(client, actor_name: str) -> tuple[Actor, str]:
    """File one correction with no replacement value, and return the member and the correction id."""
    a = Actor(client, unique_email(f"{actor_name}-a"))
    b = Actor(client, unique_email(f"{actor_name}-b"))
    onboard(a, gender="woman", seeking=["man"], name="Ana", city=CITY, zone=ZONE)
    onboard(b, gender="man", seeking=["woman"], name="Bruno", city=CITY, zone=ZONE)
    concierge = staff(client, "concierge@example.test")
    assert concierge.post("/admin/matching/runs", json={"market_id": CITY, "auto_publish": True}).status_code == 201

    served = next((actor for actor in (a, b) if actor.get("/introductions").json()["current"]), None)
    assert served, "the batch has to produce an introduction for this to be correctable"
    intro = served.get("/introductions").json()["current"][0]["id"]
    r = served.post(f"/introductions/{intro}/correction", json={"signal_key": "life_plan.children", "value": None, "note": f"{actor_name}: not even close."})
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is False

    rows = concierge.get("/admin/matching/corrections?unapplied_only=true&limit=200").json()["items"]
    mine = next(c for c in rows if c["introduction_id"] == intro)
    return served, mine["id"]


def test_the_unresolved_corrections_queue_can_be_drained(client):
    _, correction_id = _correction(client, "drain")
    concierge = staff(client, "concierge@example.test")

    queue = concierge.get("/admin/matching/corrections?unresolved_only=true&limit=200").json()
    assert correction_id in [c["id"] for c in queue["items"]]
    # `total` is the whole filtered set, not the page: without it a caller cannot tell that the
    # queue is longer than what it asked for, which is how the oldest rows went missing.
    assert queue["total"] >= len(queue["items"])
    assert all(c["review"] is None for c in queue["items"])

    r = concierge.post(f"/admin/matching/corrections/{correction_id}/review", json={"decision": "no_change", "note": "Read it; the inference stands."})
    assert r.status_code == 200, r.text
    assert r.json()["review"]["decision"] == "no_change"
    # Named, not only identified: nothing turns a staff id into a person on the client, and a
    # shared queue needs to show who settled a dispute so the next reviewer can ask them why.
    assert r.json()["review"]["reviewer"]["name"]

    after = concierge.get("/admin/matching/corrections?unresolved_only=true&limit=200").json()
    assert correction_id not in [c["id"] for c in after["items"]], "a reviewed correction must leave the unresolved queue"
    assert after["total"] == queue["total"] - 1

    # It is still there to read, with who resolved it and what they said. Resolved is not deleted:
    # the member disputed a signal that is still being used, and that record is the reason why.
    full = concierge.get("/admin/matching/corrections?unapplied_only=true&limit=200").json()["items"]
    resolved = next(c for c in full if c["id"] == correction_id)
    assert resolved["review"]["note"] == "Read it; the inference stands."
    assert resolved["review"]["reviewer"]["id"] and resolved["review"]["reviewer"]["name"]

    # Two reviewers on the same row: the second is told rather than silently overwriting the first.
    # The unique constraint is what answers, not a preceding SELECT, so this is the same code path a
    # genuinely concurrent pair of reviewers takes — where a check-then-insert gave the loser a 500.
    assert concierge.post(f"/admin/matching/corrections/{correction_id}/review", json={"decision": "actioned"}).status_code == 409
    # And the first reviewer's decision survived the second attempt intact.
    again = next(c for c in concierge.get("/admin/matching/corrections?unapplied_only=true&limit=200").json()["items"] if c["id"] == correction_id)
    assert again["review"]["decision"] == "no_change" and again["review"]["note"] == "Read it; the inference stands."
    assert again["review"]["reviewer"]["id"] == resolved["review"]["reviewer"]["id"]
    assert concierge.post("/admin/matching/corrections/nope/review", json={"decision": "actioned"}).status_code == 404


def test_the_corrections_queue_is_pageable_past_its_limit(client):
    _, first = _correction(client, "page-one")
    _, second = _correction(client, "page-two")
    concierge = staff(client, "concierge@example.test")

    page = concierge.get("/admin/matching/corrections?unapplied_only=true&limit=1").json()
    assert len(page["items"]) == 1 and page["total"] >= 2
    seen = {page["items"][0]["id"]}
    # Walking the offset reaches every row. Before this the only page was the newest `limit`, so
    # with more unapplied corrections than that the oldest could not be reached at all.
    for offset in range(1, page["total"]):
        step = concierge.get(f"/admin/matching/corrections?unapplied_only=true&limit=1&offset={offset}").json()
        assert len(step["items"]) == 1, f"offset {offset} of {page['total']} returned nothing"
        seen.add(step["items"][0]["id"])
    assert {first, second} <= seen
    # Past the end is an empty page, not an error and not a wrapped-around first page.
    assert concierge.get(f"/admin/matching/corrections?unapplied_only=true&limit=1&offset={page['total']}").json()["items"] == []
