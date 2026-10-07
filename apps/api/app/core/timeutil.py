from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def market_date(at: datetime | None = None) -> str:
    """The market's own calendar date at `at`, which is what a cohort is identified by.

    This existed twice, computed two different ways, and that is the bug it was written for. A
    `MatchRun` stamped its `cohort_date` from the UTC date, while the scheduler decided whether
    today's batch had already run by looking for the *market-local* date — so the two agreed only
    while both clocks were on the same calendar day. For Europe/Rome that is every day except
    between local midnight and the UTC offset: in that window the scheduler looks for a date
    nothing was ever written under, finds nothing, and runs the weekly batch again on every tick.
    The batch is what allocates introductions and spends the weekly cap, so running it twice is
    not a cosmetic repeat.

    Which way round it should be was never really in question: the schedule is configured in
    market time (`match_batch_weekday`, `match_batch_hour`) and a cohort is a market's week, so
    the date is the market's. The point of this function is that there is one of it.
    """
    from app.core.config import get_settings

    moment = at or utcnow()
    return moment.astimezone(ZoneInfo(get_settings().market_timezone)).date().isoformat()


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def known_timezone(name: str) -> str:
    """An IANA zone name, validated by the call that would otherwise fail.

    `timezone` was accepted as free text on `PATCH /me` and on `PUT /availability`, and nothing
    read it until a date was proposed: `member.timezone` is copied onto the plan, and the
    proposal notification formats the time with `ZoneInfo(plan.timezone)`. An unknown name
    therefore stored quietly and then raised inside the date flow — a 500 for the member who
    proposed, and another for the other member every time they opened the plan's overlaps,
    with no way back out from either app. Validating with `ZoneInfo` itself means this accepts
    exactly what the rest of the code can load, including whatever the host tz database
    carries, rather than a list that drifts from it.
    """
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("Unknown time zone. Use an IANA name such as Europe/Rome.") from exc
    return name


TimezoneName = Annotated[str, AfterValidator(known_timezone)]
