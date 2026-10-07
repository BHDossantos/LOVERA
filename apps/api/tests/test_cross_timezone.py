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
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.windows import day_intervals, intersect, local_dates_covering, offset_minutes, weekly_overlaps
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


def test_an_overlap_that_straddles_the_week_boundary_is_not_thrown_away_in_halves():
    """Far enough east, an ordinary afternoon is two pieces of the UTC week.

    Kiritimati is UTC+14, so Monday 13:00–15:00 there is 23:00 Sunday to 01:00 Monday in UTC. Both
    pieces are an hour long, and discarding each for being under the ninety-minute minimum before
    recombining them threw away a real two-hour overlap — costing the pair practical score they had
    earned. The minimum belongs after the merge, and the week is a circle.
    """
    afternoon = [{"weekday": 0, "start": "13:00", "end": "15:00"}]
    total, labels = weekly_overlaps(afternoon, "Pacific/Kiritimati", afternoon, "Pacific/Kiritimati", AT)
    assert total == 120
    assert labels == [{"weekday": 0, "start": "13:00", "end": "15:00"}], "and it reads as the afternoon it is"


def test_an_evening_running_into_the_small_hours_is_one_stretch_not_two_short_ones():
    """A window cannot cross midnight, so such an evening is stored as two windows.

    The planner had the same fault as the scorer: it applied the minimum to each pairwise
    intersection, so two contiguous hours either side of midnight were dropped as two one-hour
    pieces rather than offered as the two-hour slot they are.
    """
    evening = [{"weekday": 4, "start": "23:00", "end": "24:00"}, {"weekday": 5, "start": "00:00", "end": "01:00"}]
    days = [FRIDAY, FRIDAY + timedelta(days=1)]
    both = intersect(day_intervals(evening, "UTC", days), day_intervals(evening, "UTC", days))
    assert len(both) == 1
    start, end = both[0]
    assert end - start == timedelta(hours=2)
    assert start.hour == 23 and start.date() == FRIDAY


def test_the_offset_is_taken_at_the_instant_not_at_its_clock_reading():
    """A batch running inside a DST transition hour must not score the wrong side of it.

    `ZoneInfo.utcoffset(dt)` reads `dt`'s clock fields as local time and ignores its tzinfo, so handing
    it a UTC instant answers for the wrong side of a transition for the hour either side of one. Rome
    springs forward at 02:00 local on 2026-03-29, which is 01:00 UTC: at 01:30 UTC the offset is +2, and
    asking the old way answered +1.
    """
    transition = datetime(2026, 3, 29, 1, 30, tzinfo=timezone.utc)
    assert offset_minutes("Europe/Rome", transition) == 120
    assert ZoneInfo("Europe/Rome").utcoffset(transition) == timedelta(hours=1), "the trap, pinned so it is not reintroduced"

    # And the consequence it had: four overlapping hours scored where there are three.
    rome_evening = [{"weekday": 4, "start": "18:00", "end": "22:00"}]
    utc_evening = [{"weekday": 4, "start": "17:00", "end": "21:00"}]
    assert weekly_overlaps(rome_evening, "Europe/Rome", utc_evening, "UTC", transition)[0] == 180
    # Unchanged on an ordinary CEST day, so the fix is about the instant and not about Rome.
    assert weekly_overlaps(rome_evening, "Europe/Rome", utc_evening, "UTC", AT)[0] == 180


def test_tonight_running_into_tomorrow_is_offered_from_midnight(client):
    """No exception involved: the horizon alone has to cut the interval rather than reject it.

    With contiguous windows either side of midnight and nothing excluded, tonight-into-tomorrow stays
    one interval beginning today. Judged by that start date it is outside the fortnight and was thrown
    away whole, taking the small hours of tomorrow — which are inside it — with it. The earlier test of
    this passed only because its dated exception happened to split the interval at midnight for it,
    which review caught and I had not.
    """
    a, b, conv_id = _mutual_conversation(client)
    overnight = [{"weekday": d, "start": "22:00", "end": "24:00"} for d in range(7)]
    overnight += [{"weekday": d, "start": "00:00", "end": "02:00"} for d in range(7)]
    rome = ZoneInfo("Europe/Rome")
    tomorrow = (datetime.now(timezone.utc).astimezone(rome) + timedelta(days=1)).date()

    for who in (a, b):
        assert who.put("/availability", json={"recurring_windows": overnight, "date_styles": ["drinks"], "timezone": "Europe/Rome"}).status_code in (200, 201)

    plan_id = a.post("/date-plans", json={"conversation_id": conv_id}).json()["id"]
    offers = a.get(f"/date-plans/{plan_id}/overlaps").json()["items"]

    opening = [o for o in offers if o["date"] == tomorrow.isoformat() and o["start"] == "00:00"]
    assert opening, f"the small hours of tomorrow are inside the fortnight: {offers}"
    assert opening[0]["end"] == "02:00", "cut at the horizon, not discarded"
    # Nothing before the horizon opens, and nothing after it closes.
    latest = (datetime.now(timezone.utc).astimezone(rome) + timedelta(days=14)).date()
    assert not [o for o in offers if o["date"] < tomorrow.isoformat() or o["date"] > latest.isoformat()]


def test_the_horizon_is_judged_on_what_survives_the_cut(client):
    """The horizon was checked against the interval, not the piece left after an excluded day was cut.

    The reachable half of that is the near boundary. An overlap that starts late *today* and runs into
    tomorrow is outside the horizon as a whole — a first date is not sprung on somebody the same evening —
    but once today is cut out of it, what remains is tomorrow's small hours, which is inside. Judging the
    whole interval threw that away.

    The far boundary cannot be reached today, and only by luck: `local_days` stops at `latest`, so the
    window on `latest + 1` that would extend an interval past the horizon is never built. That is two
    numbers happening to agree rather than a guarantee, so the check belongs on the piece either way.
    """
    a, b, conv_id = _mutual_conversation(client)
    overnight = [{"weekday": d, "start": "22:00", "end": "24:00"} for d in range(7)]
    overnight += [{"weekday": d, "start": "00:00", "end": "02:00"} for d in range(7)]
    rome = ZoneInfo("Europe/Rome")
    today = datetime.now(timezone.utc).astimezone(rome).date()
    tomorrow = today + timedelta(days=1)

    for who in (a, b):
        assert who.put("/availability", json={"recurring_windows": overnight, "date_styles": ["drinks"], "timezone": "Europe/Rome"}).status_code in (200, 201)
    # B is away today, so the evening that starts today is cut and only its small hours remain.
    assert b.put(
        "/availability",
        json={"recurring_windows": overnight, "date_styles": ["drinks"], "timezone": "Europe/Rome", "dated_exceptions": [{"date": today.isoformat(), "available": False}]},
    ).status_code in (200, 201)

    plan_id = a.post("/date-plans", json={"conversation_id": conv_id}).json()["id"]
    offers = a.get(f"/date-plans/{plan_id}/overlaps").json()["items"]

    small_hours = [o for o in offers if o["date"] == tomorrow.isoformat() and o["start"] == "00:00"]
    assert small_hours, f"tomorrow's remainder of tonight's window is inside the horizon: {offers}"
    assert small_hours[0]["end"] == "02:00"

    # And the far boundary stays respected, which it was.
    latest = today + timedelta(days=14)
    assert not [o for o in offers if o["date"] > latest.isoformat() or o["date"] < tomorrow.isoformat()]


def test_each_member_gets_the_dates_the_horizon_actually_covers():
    """The candidate dates come from the horizon's instants, not from a count of days.

    A count from each member's own "yesterday" does not reach the far end of the horizon once the two
    zones are far apart, and the far end is exactly where it matters: a window that is never built
    cannot be offered, so an overlap on the plan's last day reads as no availability at all.
    """
    now = datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc)
    plan_zone = ZoneInfo("Pacific/Kiritimati")  # UTC+14
    plan_today = now.astimezone(plan_zone).date()
    opens = datetime.combine(plan_today + timedelta(days=1), time.min, tzinfo=plan_zone)
    closes = datetime.combine(plan_today + timedelta(days=15), time.min, tzinfo=plan_zone)

    other = "Etc/GMT+12"  # UTC-12, twenty-six hours behind the plan
    assert closes.astimezone(ZoneInfo(other)) == datetime(2026, 1, 15, 22, 0, tzinfo=ZoneInfo(other))
    covered = local_dates_covering(opens, closes, other)
    assert date(2026, 1, 15) in covered, "the horizon closes during that member's 15th"

    # What a fixed count of days gave instead, pinned so the reason for the change is legible.
    counted_from_yesterday = [now.astimezone(ZoneInfo(other)).date() - timedelta(days=1) + timedelta(days=i) for i in range(16)]
    assert date(2026, 1, 15) not in counted_from_yesterday
    # And it still covers the near end, a day before the horizon opens, for a window that runs into it.
    assert opens.astimezone(ZoneInfo(other)).date() - timedelta(days=1) == covered[0]


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


def _next_weekday(from_date: date, weekday: int) -> date:
    ahead = (weekday - from_date.weekday()) % 7 or 7
    return from_date + timedelta(days=ahead)


def test_a_slot_spanning_midnight_respects_an_exception_on_either_day(client):
    """The regression the merge introduced: a slot can now cross midnight, so one date is not enough.

    Contiguous windows either side of midnight are merged into the stretch they are, which is right —
    but the planner checked dated exceptions only against the date the slot *starts* on. A member who
    had marked the Saturday unavailable would have been offered a Friday-into-Saturday evening.
    """
    a, b, conv_id = _mutual_conversation(client)
    overnight = [{"weekday": 4, "start": "22:00", "end": "24:00"}, {"weekday": 5, "start": "00:00", "end": "02:00"}]
    for who in (a, b):
        r = who.put("/availability", json={"recurring_windows": overnight, "date_styles": ["drinks"], "timezone": "Europe/Rome"})
        assert r.status_code in (200, 201), r.text

    plan_id = a.post("/date-plans", json={"conversation_id": conv_id}).json()["id"]
    offers = a.get(f"/date-plans/{plan_id}/overlaps").json()["items"]
    spanning = [o for o in offers if o["start"] >= "22:00"]
    assert spanning, "the overnight stretch has to be offered before its absence means anything"

    # Now B is away on the Saturday that the first such slot runs into.
    first = datetime.fromisoformat(spanning[0]["starts_at"].replace("Z", "+00:00"))
    saturday = (first.astimezone(ZoneInfo("Europe/Rome")) + timedelta(days=1)).date().isoformat()
    r = b.put(
        "/availability",
        json={"recurring_windows": overnight, "date_styles": ["drinks"], "timezone": "Europe/Rome", "dated_exceptions": [{"date": saturday, "available": False}]},
    )
    assert r.status_code in (200, 201), r.text

    offers = a.get(f"/date-plans/{plan_id}/overlaps").json()["items"]
    rome = ZoneInfo("Europe/Rome")
    for offer in offers:
        touched = {
            (datetime.fromisoformat(offer["starts_at"].replace("Z", "+00:00")).astimezone(rome)).date().isoformat(),
            (datetime.fromisoformat(offer["ends_at"].replace("Z", "+00:00")).astimezone(rome) - timedelta(microseconds=1)).date().isoformat(),
        }
        assert saturday not in touched, f"{offer['starts_at']}–{offer['ends_at']} runs into a day B said they are away"

    # And the Friday evening either side of that boundary survives. Rejecting the whole merged stretch
    # would have taken a perfectly good two hours with it — hours the planner offered before those two
    # windows were ever merged, so losing them would be a regression dressed as a fix.
    friday = (datetime.fromisoformat(saturday) - timedelta(days=1)).date().isoformat()
    kept = [o for o in offers if o["date"] == friday and o["start"] >= "22:00"]
    assert kept, f"the Friday evening before the excluded {saturday} should still be offered: {offers}"
    assert kept[0]["end"] == "00:00", "clipped at the member's local midnight, not discarded"


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
