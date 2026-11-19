"""Reviewed, non-personal campaign codes for the pilot's own acquisition report.

Codes identify placements, never individual referrers or members. Adding a placement is a code
review, rather than accepting arbitrary URLs, UTM strings or names from a browser. Attribution
has no effect on invitations, eligibility, matching, subscriptions or rewards.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Campaign:
    code: str
    source: str
    label: str


CAMPAIGNS: dict[str, Campaign] = {
    campaign.code: campaign
    for campaign in (
        Campaign("rome-instagram", "instagram", "Rome · Instagram"),
        Campaign("rome-community", "community", "Rome · Community"),
        Campaign("rome-partners", "partner", "Rome · Partners"),
    )
}


def resolve_campaign(code: str | None) -> Campaign | None:
    """Unrecognized input contributes no campaign data, including on otherwise valid sign-ins."""
    return CAMPAIGNS.get(code) if isinstance(code, str) else None
