"""Client routes the API hands to an app, where the route cannot be written as one literal.

Everything the API returns as a `path`, a `cta_path`, a `safety_shortcut` or a notification's
`deep_link` is a route in the web app and the mobile app, not an API endpoint. The apps
navigate to it verbatim, so a path with no screen behind it is a tap that does nothing — and
nothing in Python or TypeScript catches that, because it is a string on one side and a file
name on the other.

apps/mobile/scripts/check-routes.js reads these paths back out of the source and asserts the
mobile router resolves every one. It can follow an f-string whose interpolation is a single
segment; it cannot follow a conditional that chooses between whole paths. So a path like that
is declared here as a plain mapping instead, where it is both checkable and readable.
"""
from __future__ import annotations

# Member-facing onboarding steps (Member.onboarding_step) to the screen that continues them.
# "blueprint" is the one that differs: the step is one word, the screen is the interview.
ONBOARDING_PATHS: dict[str, str] = {
    "account": "/onboarding/account",
    "verification": "/onboarding/verification",
    "intent": "/onboarding/intent",
    "blueprint": "/onboarding/blueprint/interview",
    "profile": "/onboarding/profile",
    "availability": "/onboarding/availability",
}


def onboarding_path(step: str | None) -> str:
    """The screen that continues onboarding. An unknown step sends them to the start."""
    return ONBOARDING_PATHS.get(step or "", ONBOARDING_PATHS["account"])
