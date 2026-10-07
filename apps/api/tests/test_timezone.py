"""A member's time zone is an IANA name or it is refused at the door.

`PATCH /me` and `PUT /availability` both took `timezone` as free text, and nothing read it at
the time it was stored. `member.timezone` is later copied onto a date plan
(`dates/service.py:85`) and the proposal notification formats the time with
`ZoneInfo(plan.timezone)` (`:149`), so an unknown name stored quietly on Monday and raised
`ZoneInfoNotFoundError` on Friday — a 500 for the member proposing the date, and another for
the other member every time they opened the plan's overlaps (`dates/router.py:80`), which
neither of them could undo from either app because the stored value was already there.

These tests pin the boundary rather than the blast radius: a name `ZoneInfo` cannot load never
reaches the database, so the date flow cannot inherit one.
"""
from __future__ import annotations

import pytest

from app.core.timeutil import known_timezone
from tests.conftest import Actor, unique_email


@pytest.fixture()
def member(client):
    a = Actor(client, unique_email("tz"))
    a.sign_in()
    return a


def test_a_real_zone_is_accepted_and_kept(member):
    r = member.patch("/me", json={"timezone": "Europe/Madrid", "locale": "es"})
    assert r.status_code == 200, r.text
    assert r.json()["timezone"] == "Europe/Madrid"
    assert member.get("/me").json()["timezone"] == "Europe/Madrid"


@pytest.mark.parametrize(
    "value",
    [
        "Europe/Atlantis",  # plausible, and not in any tz database
        "CEST",  # an abbreviation, not a zone name
        "Europe/Rome ",  # a trailing space is enough to make it unloadable
        "",  # empty: ZoneInfo raises rather than defaulting
        "../../../etc/passwd",  # zoneinfo resolves names against the tz database as paths
        "/etc/localtime",  # absolute, which ZoneInfo refuses with ValueError, not NotFound
    ],
)
def test_a_zone_that_cannot_be_loaded_is_refused_and_nothing_is_stored(member, value):
    before = member.get("/me").json()["timezone"]

    r = member.patch("/me", json={"timezone": value})
    assert r.status_code == 422, r.text
    assert "timezone" in r.json()["error"]["field_errors"], r.text

    assert member.get("/me").json()["timezone"] == before, "a refused value must not be written"


def test_the_availability_editor_is_the_same_door(member):
    """`PUT /availability` carries its own `timezone`, so validating only `PATCH /me` would
    leave the field writable by a client that never touches the account endpoint."""
    body = {"recurring_windows": [{"weekday": 5, "start": "18:00", "end": "22:00"}], "date_styles": ["coffee"]}

    r = member.put("/availability", json={**body, "timezone": "Europe/Atlantis"})
    assert r.status_code == 422, r.text
    assert "timezone" in r.json()["error"]["field_errors"], r.text

    r = member.put("/availability", json={**body, "timezone": "Europe/Lisbon"})
    assert r.status_code in (200, 201), r.text
    assert member.get("/availability").json()["timezone"] == "Europe/Lisbon"


def test_the_validator_accepts_exactly_what_zoneinfo_can_load():
    """Checked against `ZoneInfo` itself rather than a hand-kept list, so it cannot drift from
    the zones the rest of the code is able to format a date in."""
    assert known_timezone("Europe/Rome") == "Europe/Rome"
    assert known_timezone("UTC") == "UTC"
    with pytest.raises(ValueError):
        known_timezone("Europe/Atlantis")
