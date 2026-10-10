"""The plan catalog: honest entitlements, no boosts, safety always free.

**Why the bullets are derived rather than written.** The first version of this file kept two
lists per plan — `included`, a set of sentences a member reads, and, over in
`billing/service.py`, the booleans that actually gate the features. Nothing tied them together,
and the predictable thing happened: Concierge's `included` promised "periodic human matchmaker
review" and "priority date coordination", while `entitlements_for` computed every feature flag as
`plan in PAID_PLANS`. Concierge therefore granted *byte-for-byte the same entitlements as Pro* at
more than twice the price. It is the same shape this repository keeps finding — two things that
must agree, computed separately — and here it was also a consumer-protection problem.

So a feature is declared once, in `FEATURES`, as a key and the sentence that describes it. A plan
lists the keys it grants. The entitlement flags and the member-facing bullets are both generated
from that one list, and `tests/test_pricing.py` asserts the two can never diverge again.
"""
from __future__ import annotations

from typing import Any

# A feature key, and the sentence a member reads for it. The key is the entitlement flag name the
# API hands to both clients, so a feature cannot be advertised without also being granted.
FEATURES: dict[str, str] = {
    "adaptive_refresh": "Deep adaptive Blueprint refresh as we learn what actually matters to you",
    "weekly_introductions": "Curated introductions every week, when qualified inventory supports it",
    "ai_wingman": "AI Wingman drafts you approve before anything sends",
    "translation": "EN/IT/ES/PT translation in conversation",
    "date_concierge": "Date concierge: availability overlap and a safe public venue shortlist",
    "protected_credits": "A protected credit whenever a paid week passes without a qualified introduction",
    "human_review": "Periodic review of your matching by a human matchmaker",
    "priority_coordination": "Priority date coordination, including venue booking help",
}

# True on every plan including free, so they are listed under each one rather than sold.
ALWAYS_INCLUDED: tuple[str, ...] = (
    "Verified profile — identity and 18+ checked before anyone enters the pool",
    "A plain-language explanation with every introduction",
    "Messaging once you have both said yes",
    "Manual date planning",
    "Block, report, check-in and appeal",
)

# Stated on every plan, because the absence is the product.
NEVER_SOLD: tuple[str, ...] = (
    "Boosts, super-likes or priority reach — we do not sell them at any price",
    "Paid access to a specific person",
    "Any advantage that is hidden from the person on the other side",
)

CADENCES = ("monthly", "annual")
PERIOD_DAYS = {"monthly": 30, "annual": 365}

PLANS: dict[str, dict[str, Any]] = {
    "free": {
        "id": "free",
        "name": "Verified",
        "tagline": "See how we match before you pay for it.",
        "currency": "EUR",
        "prices": {"monthly": 0, "annual": 0},
        "weekly_intro_cap": 1,
        "features": (),
    },
    "pro": {
        "id": "pro",
        "name": "Matchmaker Pro",
        "tagline": "The whole method, every week.",
        "currency": "EUR",
        # Annual is ten months for twelve. Stated as a price, not as a percentage, because a
        # percentage off an unstated base is the oldest trick in subscription pricing.
        "prices": {"monthly": 3900, "annual": 39000},
        "weekly_intro_cap": 3,
        "features": (
            "adaptive_refresh",
            "weekly_introductions",
            "ai_wingman",
            "translation",
            "date_concierge",
            "protected_credits",
        ),
    },
    "concierge": {
        "id": "concierge",
        "name": "Concierge",
        "tagline": "Everything in Pro, with a person watching over it.",
        "currency": "EUR",
        "prices": {"monthly": 8900, "annual": 89000},
        "weekly_intro_cap": 3,
        "features": (
            "adaptive_refresh",
            "weekly_introductions",
            "ai_wingman",
            "translation",
            "date_concierge",
            "protected_credits",
            "human_review",
            "priority_coordination",
        ),
    },
}

PAID_PLANS = ("pro", "concierge")

RENEWAL_TERMS = (
    "Renews until you cancel, monthly or annually as you chose. Cancel any time in the app; access "
    "continues to the end of the period you have paid for. If we cannot make a qualified "
    "introduction in a paid week, a protected credit extends your membership rather than lapsing."
)


def plan(plan_id: str) -> dict[str, Any]:
    return PLANS[plan_id]


def grants(plan_id: str, feature: str) -> bool:
    """The single authority on whether a plan grants a feature."""
    return feature in PLANS[plan_id]["features"]


def price_cents(plan_id: str, cadence: str) -> int:
    return PLANS[plan_id]["prices"][cadence]


def monthly_equivalent_cents(plan_id: str, cadence: str) -> int:
    """What the annual price works out to per month, for honest side-by-side display."""
    total = price_cents(plan_id, cadence)
    return total if cadence == "monthly" else round(total / 12)


def annual_saving_cents(plan_id: str) -> int:
    p = PLANS[plan_id]["prices"]
    return max(p["monthly"] * 12 - p["annual"], 0)


def included_for(plan_id: str) -> list[str]:
    """What this plan gives, generated from the features it actually grants."""
    return [FEATURES[k] for k in PLANS[plan_id]["features"]] + list(ALWAYS_INCLUDED)


def not_included_for(plan_id: str) -> list[str]:
    """What this plan does not give: the features a higher plan has, then what nobody can buy."""
    missing = [FEATURES[k] for k in FEATURES if not grants(plan_id, k)]
    return missing + list(NEVER_SOLD)


def plan_payload(plan_id: str) -> dict[str, Any]:
    p = PLANS[plan_id]
    out: dict[str, Any] = {
        "id": p["id"],
        "name": p["name"],
        "tagline": p["tagline"],
        "currency": p["currency"],
        "weekly_intro_cap": p["weekly_intro_cap"],
        "features": list(p["features"]),
        "included": included_for(plan_id),
        "not_included": not_included_for(plan_id),
        "prices": {
            c: {
                "cents": price_cents(plan_id, c),
                "monthly_equivalent_cents": monthly_equivalent_cents(plan_id, c),
                "period_days": PERIOD_DAYS[c],
            }
            for c in CADENCES
        },
        "annual_saving_cents": annual_saving_cents(plan_id),
        # The clients were written against a flat monthly price and a `cadence` string. Both are
        # kept so an older build keeps rendering something true rather than something empty.
        "price_cents": price_cents(plan_id, "monthly"),
        "cadence": "monthly",
    }
    return out
