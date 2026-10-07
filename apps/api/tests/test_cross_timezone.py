"""Two members in different time zones are free at the same *instants*, not the same clock readings.

A recurring window is `{weekday, start, end}` and it means "Friday 18:00 where I am". Both places
that intersect two members' availability compared those values directly:

  * `matching/scoring.py:availability_overlap` matched `weekday` and then `HH:MM` to `HH:MM`;
  * `dates/service.py:overlaps` applied one zone — the proposer's, or the plan's — to both members.

That holds only while everybody reads the clock the same way. Members take their zone from their
city, and Rome and Barcelona share an offset, which is why nothing caught it. It stops holding the
moment a member changes their zone, which is what somebody who has moved does — and both apps offer
that control, mobile from this branch and the web app since launch. The matcher would then score
overlap that does not exist, and the date planner would offer a slot outside one member's evening.

These tests pin the arithmetic, and then the endpoint, with two members an hour apart.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.windows import day_intervals, intersect, weekly_overlaps
from tests.conftest import Actor, onboard, staff, subscribe, unique_email

# A Friday, and well clear of any European DST change so the offsets in the assertions are stable.
FRIDAY = date(2026, 10, 9)
AT = datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)
EVENING = [{"weekday": 4, "start": "18:00", "end": "22:00"}]


def test_the_same_evening_in_two_zones_is_only_partly_the_same_evening():
    """Rome 18:00–22:00 is Lisbon 17:00–21:00, so the shared part is three hours, not four."""
    both = intersect(
        day_intervals(EVENING, "Europe/Rome", [FRIDAY]),
        day_intervals(EVENING, "Europe/Lisbon", [FRIDAY]),
    )
    assert len(both) == 1
    start, end = both[0]
    assert end - start == timedelta(hours=3), "the raw comparison would have claimed four"

    # And the slot is genuinely inside both members' stated evenings, which is the property a member
    # cares about: nobody is asked to turn up at a time they did not offer.
    for name in ("Europe/Rome", "Europe/Lisbon"):
        local_start, local_end = start.astimezone(ZoneInfo(name)), end.astimezone(ZoneInfo(name))
        assert local_start.date() == FRIDAY and local_end.date() == FRIDAY
        assert local_start.hour >= 18 and local_end.hour <= 22, name


def test_zones_far_enough_apart_share_no_evening_at_all():
    """The old comparison would have reported a full four-hour overlap here."""
    assert intersect(
        day_intervals(EVENING, "Europe/Rome", [FRIDAY]),
        day_intervals(EVENING, "America/New_York", [FRIDAY]),
    ) == []
    assert weekly_overlaps(EVENING, "Europe/Rome", EVENING, "America/New_York", AT) == (0, [])


def test_the_score_sees_the_real_week_and_keeps_the_shape_the_explanation_reads():
    same = weekly_overlaps(EVENING, "Europe/Rome", EVENING, "Europe/Rome", AT)
    assert same == (240, [{"weekday": 4, "start": "18:00", "end": "22:00"}])
    # `weekday` stays the 0-6 index `explanation.py` indexes its own day names with.
    assert isinstance(same[1][0]["weekday"], int)

    apart = weekly_overlaps(EVENING, "Europe/Rome", EVENING, "Europe/Lisbon", AT)
    assert apart[0] == 180
    assert apart[1] == [{"weekday": 4, "start": "19:00", "end": "22:00"}], "labelled in the first member's zone"


def test_a_window_that_crosses_the_week_once_converted_is_counted_once():
    """Rome's small hours are the previous UTC day, so the window wraps Monday 00:00 UTC.

    It is split in two to live on the week, and summing the pairwise intersections of the halves
    without merging them would count the same minutes twice.
    """
    rome_small_hours = [{"weekday": 0, "start": "00:30", "end": "04:00"}]
    utc_monday_morning = [{"weekday": 0, "start": "00:00", "end": "02:00"}]
    total, labels = weekly_overlaps(rome_small_hours, "Europe/Rome", utc_monday_morning, "UTC", AT)
    assert total == 120, "02:00-04:00 Rome is 00:00-02:00 UTC"
    assert labels == [{"weekday": 0, "start": "02:00", "end": "04:00"}]


def _mutual_conversation(client) -> tuple[Actor, Actor, str]:
    """Two members through onboarding, matched, both accepting: the state a date needs."""
    a = Actor(client, unique_email("tz-a"))
    b = Actor(client, unique_email("tz-b"))
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
    assert intro, "the pair has to be introduced before a date can be planned"
    for who in (a, b):
        r = who.post(f"/introductions/{intro['id']}/decision", json={"decision": "accept"}, headers={"Idempotency-Key": str(uuid.uuid4())})
        assert r.status_code == 202, r.text
    conv_id = r.json()["conversation_id"]
    assert conv_id
    return a, b, conv_id


def test_the_planner_offers_only_slots_inside_both_members_own_evenings(client):
    """The endpoint, not the arithmetic: one member moves to Lisbon and the offers stay honest."""
    a, b, conv_id = _mutual_conversation(client)
    windows = a.get("/availability").json()["recurring_windows"]
    assert windows, "onboarding sets availability, which this test depends on"

    assert b.patch("/me", json={"timezone": "Europe/Lisbon"}).status_code == 200

    plan = a.post("/date-plans", json={"conversation_id": conv_id})
    assert plan.status_code == 201, plan.text
    offers = a.get(f"/date-plans/{plan.json()['id']}/overlaps").json()["items"]
    assert offers, "an hour apart still leaves a shared evening; the pair would not be matched otherwise"

    a_zone, b_zone = ZoneInfo("Europe/Rome"), ZoneInfo("Europe/Lisbon")
    by_weekday: dict[int, list[dict]] = {}
    for w in windows:
        by_weekday.setdefault(w["weekday"], []).append(w)

    for offer in offers:
        start = datetime.fromisoformat(offer["starts_at"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(offer["ends_at"].replace("Z", "+00:00"))
        for zone, who in ((a_zone, "the proposer"), (b_zone, "the member who moved")):
            local_start, local_end = start.astimezone(zone), end.astimezone(zone)
            candidates = by_weekday.get(local_start.weekday(), [])
            assert candidates, f"{who} is not free on {local_start:%A} at all, yet it was offered"
            assert any(
                w["start"] <= local_start.strftime("%H:%M") and local_end.strftime("%H:%M") <= w["end"]
                for w in candidates
            ), f"{offer['starts_at']} falls outside every window {who} stated ({local_start:%A %H:%M}-{local_end:%H:%M})"
