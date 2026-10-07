"""Which day a weekly batch belongs to, and why there is only one answer to it.

`MatchRun.cohort_date` is what stops the weekly batch running twice: the scheduler looks for a
run already stamped with today's date and returns early if it finds one. The run stamped itself
from the UTC date while the scheduler searched for the *market-local* date, so the two agreed
only while both clocks were on the same calendar day — and for Europe/Rome they are not, between
local midnight and the UTC offset. In that window the scheduler looks for a date nothing was ever
written under, finds nothing, and runs the batch again on every tick. The batch allocates
introductions and spends the weekly cap, so that is members getting duplicate introductions and
a cap that does not hold.

The default schedule (Thursday 16:00 Europe/Rome) keeps away from the window, which is why this
was never seen. `tests/test_journey.py::test_worker_runs_weekly_batch_once_per_cohort_date` sets
the schedule to the current hour, so it fails for real in those two hours and passes in the other
twenty-two — which is how it was found.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.core.timeutil import market_date


def test_the_cohort_date_is_the_market_s_day_not_the_utc_day():
    # 22:30 UTC on the 7th is 00:30 on the 8th in Europe/Rome, and the market's day is the 8th.
    assert market_date(datetime(2026, 10, 7, 22, 30, tzinfo=timezone.utc)) == "2026-10-08"
    # Midday, where the two clocks agree and nothing was ever wrong.
    assert market_date(datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)) == "2026-10-07"
    # And in winter, when the offset is one hour rather than two: 23:30 UTC is 00:30 local.
    assert market_date(datetime(2026, 1, 14, 23, 30, tzinfo=timezone.utc)) == "2026-01-15"
    assert market_date(datetime(2026, 1, 14, 22, 30, tzinfo=timezone.utc)) == "2026-01-14"


def test_a_run_started_by_hand_is_stamped_with_the_market_s_day(client):
    """The admin path passes no cohort date, so it has to reach the same answer on its own."""
    from app.core.timeutil import market_date as current

    from app.core.db import session_factory
    from app.modules.matching.service import run_batch

    db = session_factory()()
    try:
        run = run_batch(db, "cohort-test-market", triggered_by="test", auto_publish=False)
        db.commit()
        assert run.cohort_date == current()
    finally:
        db.close()
