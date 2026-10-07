"""Availability windows are local wall-clock, so two members in different zones need converting.

A recurring window is `{weekday, start, end}` and it means "Friday, 18:00 to 22:00, where I am".
Both places that intersect two members' availability used to compare those raw values directly:

  * `matching/scoring.py:availability_overlap` matched `weekday` and then `HH:MM` against `HH:MM`;
  * `dates/service.py:overlaps` took a single zone and applied it to both members' windows, then
    built the absolute `starts_at` the clients offer in it.

That is only correct while every member is in the same zone. Members declare a city, and the two
markets we run in — Rome and Barcelona — happen to share an offset, which is why this held for so
long. It stops holding the moment a member changes their zone, which is exactly what somebody who
has moved does: one member keeps Friday 18:00–22:00 in Rome, the other sets Lisbon, and an hour of
the claimed overlap does not exist. The matcher would score four hours of overlap where there are
three, and the date planner would offer a slot an hour outside one member's stated evening.

So intersection happens on instants, never on wall-clock strings. Two kinds are needed:

  * `day_intervals` + `intersect` for the date planner, which has concrete dates and must be exact
    across a DST boundary — a window is built in its own zone on its own local date, so the offset
    is whatever applies that day;
  * `weekly_overlaps` for the matcher, which scores a recurring week with no dates at all. That one
    uses each zone's offset at a reference instant, which is an approximation across a DST change
    and is fine for a score: it is a ranking input, not a time anybody is asked to turn up at.

Which zone is a member's windows in? Their current `Member.timezone`. `AvailabilityVersion` records
the zone it was saved with, but a member who moves and updates their setting means "my evenings,
where I now live" rather than "the same instants as before" — which is what the settings screen
promises them in both apps.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
WEEK_MINUTES = 7 * 24 * 60

Interval = tuple[datetime, datetime]


def minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def hhmm(total: int) -> str:
    return f"{total // 60 % 24:02d}:{total % 60:02d}"


def day_intervals(windows: list[dict[str, Any]], tz: str, days: list[date]) -> list[Interval]:
    """Each window as an absolute interval, built on its own local date in its own zone.

    `days` are dates in `tz`, so a window's offset is the one in force on that date — correct
    through a DST change rather than approximately correct.
    """
    zone = ZoneInfo(tz)
    out: list[Interval] = []
    for day in days:
        for w in windows:
            if w.get("weekday") != day.weekday():
                continue
            start, end = minutes(w["start"]), minutes(w["end"])
            if end <= start:
                continue
            midnight = datetime.combine(day, time.min, tzinfo=zone)
            out.append((midnight + timedelta(minutes=start), midnight + timedelta(minutes=end)))
    return out


def intersect(a: list[Interval], b: list[Interval], minimum_minutes: int = 90) -> list[Interval]:
    """The intervals both sides are free for, long enough to be worth offering, merged and sorted.

    Merging comes *before* the minimum, not after. A window cannot cross midnight, so an evening that
    runs into the small hours is stored as two windows — and in another zone an ordinary evening
    becomes two. Applying the minimum to each piece first discards a genuine two-hour overlap that
    happens to arrive as two contiguous hours. Merging also stops the same minutes being counted
    twice when a window arrives split.
    """
    found: list[Interval] = []
    for a_start, a_end in a:
        for b_start, b_end in b:
            start, end = max(a_start, b_start), min(a_end, b_end)
            if end > start:
                found.append((start, end))
    return [(start, end) for start, end in merge(found) if (end - start) >= timedelta(minutes=minimum_minutes)]


def merge(intervals: list[Interval]) -> list[Interval]:
    """Touching or overlapping intervals joined into one. Contiguous counts as joined: two windows
    either side of midnight are one stretch of an evening, not two."""
    out: list[Interval] = []
    for start, end in sorted(intervals):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def week_intervals(windows: list[dict[str, Any]], tz: str, at: datetime) -> list[tuple[int, int]]:
    """Each window as `[start, end)` minutes from Monday 00:00 UTC, split where it wraps the week.

    Used for scoring a recurring week, where there is no date to take an offset from, so the offset
    in force at `at` stands in for all of them.
    """
    offset = int((ZoneInfo(tz).utcoffset(at) or timedelta()).total_seconds() // 60)
    out: list[tuple[int, int]] = []
    for w in windows:
        start, end = minutes(w["start"]), minutes(w["end"])
        if end <= start:
            continue
        begins = (w.get("weekday", 0) * 1440 + start - offset) % WEEK_MINUTES
        finishes = begins + (end - start)
        if finishes <= WEEK_MINUTES:
            out.append((begins, finishes))
        else:
            # The window crosses Monday 00:00 UTC once converted, so it is two intervals on the week.
            out.append((begins, WEEK_MINUTES))
            out.append((0, finishes - WEEK_MINUTES))
    return out


def weekly_overlaps(
    a_windows: list[dict[str, Any]],
    a_tz: str,
    b_windows: list[dict[str, Any]],
    b_tz: str,
    at: datetime,
    minimum_minutes: int = 90,
    label_tz: str | None = None,
) -> tuple[int, list[dict[str, Any]]]:
    """Total overlapping minutes in a week, and the overlaps labelled in `label_tz` (default `a_tz`).

    A label is a weekday index and a clock time, so it only means anything in some zone; the
    viewer's would be ideal, but a pair's evidence is stored once and read by both explanations, so
    it is the first member's unless told otherwise. `weekday` stays the 0–6 index the explanation
    builder indexes its own day names with — the shape the scorer has always emitted.
    """
    a_week = week_intervals(a_windows, a_tz, at)
    b_week = week_intervals(b_windows, b_tz, at)
    found: list[tuple[int, int]] = []
    for a_start, a_end in a_week:
        for b_start, b_end in b_week:
            start, end = max(a_start, b_start), min(a_end, b_end)
            if end > start:
                found.append((start, end))

    merged: list[tuple[int, int]] = []
    for start, end in sorted(found):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    # The week is a circle, so a piece ending at Monday 00:00 UTC and one starting there are the same
    # stretch. Far enough east, an ordinary Monday afternoon is split that way — Kiritimati is
    # UTC+14, so 13:00–15:00 Monday is 23:00 Sunday to 01:00 Monday in UTC — and applying the minimum
    # to each half discarded a real two-hour overlap as two one-hour ones. The join carries an end
    # past the week's length to mark the wrap; the label below reads it modulo the day.
    if len(merged) > 1 and merged[0][0] == 0 and merged[-1][1] == WEEK_MINUTES:
        first_start, first_end = merged.pop(0)
        last_start, _ = merged.pop()
        merged.append((last_start, WEEK_MINUTES + first_end))
        merged.sort()

    merged = [(start, end) for start, end in merged if end - start >= minimum_minutes]

    offset = int((ZoneInfo(label_tz or a_tz).utcoffset(at) or timedelta()).total_seconds() // 60)
    labelled = []
    total = 0
    for start, end in merged:
        total += end - start
        local = (start + offset) % WEEK_MINUTES
        labelled.append({"weekday": local // 1440, "start": hhmm(local), "end": hhmm(local + (end - start))})
    return total, labelled
