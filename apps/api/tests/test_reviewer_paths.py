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

    after = concierge.get("/admin/matching/corrections?unresolved_only=true&limit=200").json()
    assert correction_id not in [c["id"] for c in after["items"]], "a reviewed correction must leave the unresolved queue"
    assert after["total"] == queue["total"] - 1

    # It is still there to read, with who resolved it and what they said. Resolved is not deleted:
    # the member disputed a signal that is still being used, and that record is the reason why.
    full = concierge.get("/admin/matching/corrections?unapplied_only=true&limit=200").json()["items"]
    resolved = next(c for c in full if c["id"] == correction_id)
    assert resolved["review"]["note"] == "Read it; the inference stands."
    assert resolved["review"]["reviewer_id"]

    # Two reviewers on the same row: the second is told rather than silently overwriting the first.
    # The unique constraint is what answers, not a preceding SELECT, so this is the same code path a
    # genuinely concurrent pair of reviewers takes — where a check-then-insert gave the loser a 500.
    assert concierge.post(f"/admin/matching/corrections/{correction_id}/review", json={"decision": "actioned"}).status_code == 409
    # And the first reviewer's decision survived the second attempt intact.
    again = next(c for c in concierge.get("/admin/matching/corrections?unapplied_only=true&limit=200").json()["items"] if c["id"] == correction_id)
    assert again["review"]["decision"] == "no_change" and again["review"]["note"] == "Read it; the inference stands."
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
