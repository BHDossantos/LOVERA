"""Plan catalog: honest entitlements, no boosts, safety always free."""
from __future__ import annotations

PLANS = {
    "free": {
        "id": "free",
        "name": "Verified",
        "price_cents": 0,
        "currency": "EUR",
        "cadence": "monthly",
        "weekly_intro_cap": 1,
        "included": [
            "Verified profile",
            "One trial introduction with a full explanation",
            "Messaging after mutual acceptance",
            "Manual date planning",
            "Block, report, check-in, and appeal",
            "Essential deal-breakers and safety tools",
        ],
        "not_included": ["Weekly curated introductions", "AI Wingman drafts and translation", "Date concierge venue shortlist"],
    },
    "pro": {
        "id": "pro",
        "name": "Matchmaker Pro",
        "price_cents": 3900,
        "currency": "EUR",
        "cadence": "monthly",
        "weekly_intro_cap": 3,
        "included": [
            "Deep adaptive Blueprint refresh",
            "Up to three qualified introductions per week when inventory supports it",
            "Why-this-person explanation with every introduction",
            "Preference learning from your private feedback",
            "AI Wingman drafts and EN/IT/ES/PT translation (you approve every send)",
            "Date concierge: availability overlap and safe venue shortlist",
            "Protected credit when no qualified introduction is available",
        ],
        "not_included": ["Boosts or priority reach (we don't sell them)", "Paid access to a specific person"],
    },
    "concierge": {
        "id": "concierge",
        "name": "Concierge",
        "price_cents": 8900,
        "currency": "EUR",
        "cadence": "monthly",
        "weekly_intro_cap": 3,
        "included": ["Everything in Matchmaker Pro", "Periodic human matchmaker review", "Priority date coordination"],
        "not_included": ["Boosts or hidden visibility advantages"],
    },
}

PAID_PLANS = ("pro", "concierge")
RENEWAL_TERMS = "Renews monthly until you cancel. Cancel any time in the app; access continues to the end of the paid period. If we cannot make a qualified introduction in a paid week, a protected credit extends your membership."


def plan(plan_id: str) -> dict:
    return PLANS[plan_id]
