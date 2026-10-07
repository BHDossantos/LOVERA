"""The API hands client routes back to the apps; those routes have to exist.

apps/mobile/scripts/check-routes.js asserts the mobile router resolves every path in here and
every path emitted at a call site. This file pins the other half: that the steps the API can
actually be in all have a path, so the checker is checking the real set rather than a stale
copy of it.
"""
from __future__ import annotations

from app.core.client_paths import ONBOARDING_PATHS, onboarding_path


def test_every_onboarding_step_the_api_can_set_has_a_path() -> None:
    # The steps advance_onboarding() and the verification flow assign, from
    # app/modules/account/service.py. "done" is not one: a finished member has no step screen.
    steps = {"account", "verification", "intent", "blueprint", "profile", "availability"}
    assert steps <= set(ONBOARDING_PATHS)


def test_the_blueprint_step_points_at_the_interview_not_the_step_name() -> None:
    # The step is one word and the screen is the interview; this is the only one that differs,
    # and getting it wrong is a tap that goes nowhere rather than an error anybody sees.
    assert onboarding_path("blueprint") == "/onboarding/blueprint/interview"


def test_an_unknown_or_missing_step_sends_the_member_to_the_start() -> None:
    assert onboarding_path(None) == "/onboarding/account"
    assert onboarding_path("done") == "/onboarding/account"
    assert onboarding_path("something_we_renamed") == "/onboarding/account"
