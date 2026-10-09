"""What a member is told when their photo is bigger than the API will take.

Two limits sat on this path and did not agree. `create_media` refused a declared
`size_bytes` over 15 MiB, while `complete_media`'s `data_url` was capped by Pydantic at
15,000,000 *characters* — base64, so about 11.25 MB of actual file. A photo between the
two passed the first gate, which created the row, and then failed the second as a bare
string-length error, which the handler in `app/main.py` renders as "Some fields need
attention." Nothing in that names the size, so the member had no idea what to do, and the
row stayed behind: `media_for` does not filter by `upload_state`, so abandoned uploads
counted toward the six-photo cap and eventually the member was told they already had six
photos while their profile showed fewer, with nothing to delete.

A phone is where this bites. 11.25 MB of JPEG is one photo off a recent camera.
"""
from __future__ import annotations

import base64

from sqlalchemy import select

from tests.conftest import Actor, onboard, unique_email

# Valid JPEG as far as `decode_data_url`'s signature check is concerned, and compressible,
# so a large one costs little to carry around in a test.
def jpeg(size: int) -> str:
    raw = b"\xff\xd8\xff" + b"\x00" * max(size - 3, 0)
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode()


def member(client) -> Actor:
    a = Actor(client, unique_email("upload"))
    a.sign_in()
    onboard(a, gender="woman", seeking=["man"], name="Nadia")
    return a


def photo_rows(actor: Actor) -> list[dict]:
    """Every photo row the member has, finished or not — which is what `/profile` returns."""
    r = actor.get("/profile")
    assert r.status_code == 200, r.text
    return [m for m in r.json()["media"] if m["type"] == "photo"]


def photos(actor: Actor) -> list[dict]:
    """The photos they actually have. An unfinished upload has no URL and is shown by neither app."""
    return [m for m in photo_rows(actor) if m["upload_state"] == "complete"]


def test_a_photo_too_big_to_store_is_refused_before_a_row_exists(client):
    """The declared size is checked against what `complete` can actually accept.

    12,000,000 bytes is under the old 15 MiB gate and over what 15,000,000 base64
    characters can carry, which is the whole of the gap.
    """
    a = member(client)
    before = len(photo_rows(a))
    r = a.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 12_000_000})
    assert r.status_code == 422, r.text
    body = r.json()["error"]
    assert "large" in body["message"].lower(), body
    assert body["field_errors"]["size_bytes"] == "too_large", body
    assert len(photo_rows(a)) == before, "a refused upload must not leave a photo row behind"


def test_an_oversized_data_url_says_so(client):
    """A client that under-declares still gets a reason, not a string-length error.

    This is the backstop for the gate above, and the only gate the safety evidence
    endpoint has — where "Some fields need attention." lands on somebody reporting
    harassment.
    """
    a = member(client)
    r = a.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 1})
    assert r.status_code == 201, r.text
    mid = r.json()["media"]["id"]
    r = a.post(f"/profile/media/{mid}/complete", json={"data_url": jpeg(12_000_000)})
    assert r.status_code == 422, r.text
    body = r.json()["error"]
    assert "large" in body["message"].lower(), body
    assert body["field_errors"].get("data_url") == "invalid", body


def test_an_abandoned_upload_does_not_use_up_a_photo_slot(client):
    """Six interrupted uploads must not read as six photos.

    Nothing completes here, which is what a lost connection partway through an 11 MB
    photo looks like from the server's side.
    """
    a = member(client)
    for _ in range(6):
        r = a.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 1200})
        assert r.status_code == 201, r.text
    assert len(photos(a)) >= 1, "onboarding leaves one real photo"
    r = a.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 1200})
    assert r.status_code == 201, r.text


def test_the_recorded_size_is_the_bytes_actually_stored(client, app):
    """`size_bytes` is the member's own claim until the bytes arrive.

    Mobile sends the picked asset's file size while uploading a re-encoded JPEG, so the
    number on the row described a file nobody has.
    """
    from app.core.db import get_engine
    from app.models.profile import ProfileMedia
    from sqlalchemy.orm import Session as OrmSession

    a = member(client)
    r = a.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 999_999})
    assert r.status_code == 201, r.text
    mid = r.json()["media"]["id"]
    body = jpeg(4096)
    r = a.post(f"/profile/media/{mid}/complete", json={"data_url": body})
    assert r.status_code == 200, r.text
    with OrmSession(get_engine()) as s:
        row = s.execute(select(ProfileMedia).where(ProfileMedia.id == mid)).scalar_one()
        assert row.size_bytes == 4096, f"recorded {row.size_bytes} for a 4096-byte photo"


def test_the_photo_limit_holds_where_a_photo_becomes_one(client):
    """Seven rows created before any of them completes must still leave six photos.

    The limit used to be checked only at creation, and creation cannot see the future: each of
    those calls counted six rows that were not yet photos. Enforcing it where the bytes land is
    the only gate that cannot be walked around this way.
    """
    a = member(client)
    body = jpeg(512)
    ids = []
    for _ in range(8):
        r = a.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 512})
        if r.status_code == 409:
            break
        assert r.status_code == 201, r.text
        ids.append(r.json()["media"]["id"])
    completed = 0
    for mid in ids:
        r = a.post(f"/profile/media/{mid}/complete", json={"data_url": body})
        if r.status_code == 409:
            assert "six photos" in r.json()["error"]["message"], r.text
            continue
        assert r.status_code == 200, r.text
        completed += 1
    assert len(photos(a)) == 6, photos(a)


def test_an_upload_nobody_finished_is_swept(client, app):
    """A row left behind by a dropped connection does not stay forever.

    Aged past the grace period by hand, because the alternative is a test that sleeps for half an
    hour. What is asserted is the sweep itself: the next create removes it.
    """
    from app.core.db import get_engine
    from app.core.timeutil import utcnow
    from app.models.profile import ProfileMedia
    from app.modules.profile.service import ABANDONED_UPLOAD_AFTER
    from datetime import timedelta
    from sqlalchemy.orm import Session as OrmSession

    a = member(client)
    r = a.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 512})
    assert r.status_code == 201, r.text
    stale = r.json()["media"]["id"]
    with OrmSession(get_engine()) as s:
        row = s.execute(select(ProfileMedia).where(ProfileMedia.id == stale)).scalar_one()
        row.created_at = utcnow() - ABANDONED_UPLOAD_AFTER - timedelta(minutes=1)
        s.commit()

    r = a.post("/profile/media", json={"type": "photo", "content_type": "image/jpeg", "size_bytes": 512})
    assert r.status_code == 201, r.text
    with OrmSession(get_engine()) as s:
        row = s.execute(select(ProfileMedia).where(ProfileMedia.id == stale)).scalar_one()
        assert row.deleted_at is not None, "an abandoned upload should be swept by the next one"


def test_evidence_too_large_is_told_what_is_wrong_with_it(client):
    """The safety path has only one gate, and what came out of it said nothing.

    `POST /safety/reports/{id}/evidence` takes the file in a single call, so there is no declared
    size to check first — the data URL's own length was the only limit, and a string-length error on
    a safety report reads as "Some fields need attention." to somebody reporting harassment.
    """
    a = member(client)
    subject = member(client)
    r = a.post("/safety/reports", json={"subject_id": subject.id, "category": "harassment", "urgency": "recent", "block_now": False})
    assert r.status_code == 201, r.text
    report_id = r.json()["id"]

    r = a.post(
        f"/safety/reports/{report_id}/evidence",
        json={"content_type": "image/jpeg", "size_bytes": 1, "checksum": None, "description": "The message", "data_url": jpeg(12_000_000)},
    )
    assert r.status_code == 422, r.text
    assert "large" in r.json()["error"]["message"].lower(), r.text

    # And one that fits records the bytes it carried rather than the size the client claimed.
    r = a.post(
        f"/safety/reports/{report_id}/evidence",
        json={"content_type": "image/jpeg", "size_bytes": 1, "checksum": None, "description": "The message", "data_url": jpeg(2048)},
    )
    assert r.status_code == 201, r.text
    from app.core.db import get_engine
    from app.models.safety import SafetyEvidence
    from sqlalchemy.orm import Session as OrmSession

    with OrmSession(get_engine()) as s:
        row = s.execute(select(SafetyEvidence).where(SafetyEvidence.report_id == report_id).order_by(SafetyEvidence.id.desc())).scalars().first()
        assert row.size_bytes == 2048, f"recorded {row.size_bytes} for a 2048-byte attachment"
