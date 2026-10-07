from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
