"""Faithful explanation: three reasons, one friction, one unknown. Only approved structured factors are eligible."""
from __future__ import annotations

import re
from typing import Any

from app.catalog.signals import PREFERENCES, SIGNALS
from app.modules.matching.snapshot import Snapshot

GENERATOR_VERSION = "explainer-rules-2026-09"
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
PROHIBITED = re.compile(r"\b(race|ethnic|religio|faith|disab|diagnos|attractiv|beaut|sexy|hot\b|score|%|percent)", re.IGNORECASE)

SIMILARITY_COPY = {
    "daily.social_rhythm": ("Social rhythm", "You both described a {value} social pace."),
    "daily.weekend_energy": ("Weekend energy", "Your ideal weekends sound alike: {value}."),
    "interaction.conflict_repair": ("Communication and repair", "You both said you {value} after a disagreement."),
    "interaction.communication_pace": ("Contact between dates", "You both want {value} between dates."),
    "interaction.planning_style": ("Planning style", "You are both {value} planners."),
    "values.family_closeness": ("Family", "You both described family as {value}."),
    "daily.health_lifestyle": ("Movement and health", "You both described yourselves as {value}."),
    "interaction.affection": ("Affection", "You both described yourselves as {value}."),
    "values.money_style": ("Money", "You both described yourselves as {value} with money."),
    "values.career_drive": ("Work", "You both described work as {value}."),
}
VALUE_COPY = {
    "daily.social_rhythm": {"homebody": "quieter, home-first", "balanced": "balanced", "social": "outgoing"},
    "daily.weekend_energy": {"calm": "slow and calm", "mixed": "a mix of calm and active", "active": "active and full"},
    "interaction.conflict_repair": {"talk_now": "talk it through right away", "cool_off_then_talk": "take a moment and then talk", "avoid": "let things settle"},
    "interaction.communication_pace": {"daily": "a daily check-in", "few_times_week": "contact a few times a week", "flexible": "a flexible pace"},
    "interaction.planning_style": {"planner": "ahead-of-time", "mixed": "flexible", "spontaneous": "spontaneous"},
    "values.family_closeness": {"very_close": "very present", "close": "close", "independent": "close but independent"},
    "daily.health_lifestyle": {"active": "very active", "moderate": "moderately active", "relaxed": "relaxed about exercise"},
    "interaction.affection": {"high": "very affectionate", "moderate": "warm in a measured way", "reserved": "reserved but caring"},
    "values.money_style": {"saver": "careful", "balanced": "balanced", "spender": "generous"},
    "values.career_drive": {"ambitious": "central", "balanced": "important but balanced", "relaxed": "not the centre of life"},
}
FRICTION_COPY = {
    "daily.social_rhythm": "{name} described a {other} social pace while you described a {mine} one.",
    "daily.weekend_energy": "{name}'s ideal weekend is {other}; yours is {mine}.",
    "interaction.conflict_repair": "After a disagreement {name} tends to {other}, while you {mine}.",
    "interaction.communication_pace": "{name} prefers {other} between dates; you prefer {mine}.",
    "interaction.planning_style": "{name} is a more {other} planner than you.",
    "values.family_closeness": "{name} described family as {other}; you described it as {mine}.",
    "daily.health_lifestyle": "{name} is {other}; you are {mine}.",
}
UNKNOWN_COPY = {
    "interaction.conflict_repair": "How each of you handles the first real disagreement.",
    "interaction.communication_pace": "Whether your messaging pace feels right to both of you.",
    "interaction.planning_style": "How each of you handles last-minute plan changes.",
    "daily.social_rhythm": "How your weeknight rhythms fit once you're seeing each other.",
    "values.family_closeness": "How family time would fit around a relationship.",
    "interaction.affection": "How you each like affection to be shown.",
    "daily.weekend_energy": "What a shared weekend would actually look like.",
}


def _strength(conf_a: str | None, conf_b: str | None) -> str:
    if conf_a == "strong" and conf_b == "strong":
        return "strong"
    if "low_evidence" in (conf_a, conf_b):
        return "low_evidence"
    return "promising"


def build_explanation(me: Snapshot, other: Snapshot, features: dict[str, Any]) -> dict[str, Any]:
    reasons: list[dict[str, Any]] = []
    evidence_ids: list[str] = []
    snap = features["snapshot"]
    # 1. Life plan alignment from satisfied Must/Prefer preferences (both directions)
    life_plan_hits = []
    for pref in me.preferences:
        pdef = PREFERENCES.get(pref.key)
        if not pdef or pdef.target not in SIGNALS or SIGNALS[pdef.target].special_category:
            continue
        value = other.signals.get(pdef.target)
        if value and value in pref.value.get("in", []) and pdef.target.startswith("life_plan"):
            life_plan_hits.append((pdef.target, value))
    if life_plan_hits:
        key, value = life_plan_hits[0]
        label = SIGNALS[key].label
        reasons.append({"label": f"{label} plans", "strength": _strength(me.confidences.get(key), other.confidences.get(key)), "text": f"{other.display_name}'s answer on {label.lower()} (“{SIGNALS[key].options[value]}”) fits what you said you need.", "evidence_ids": [f"pref:{key}", f"signal:{key}"]})
        evidence_ids += [f"pref:{key}", f"signal:{key}"]
    # 2. Similar rhythm signals
    sims = sorted([e for e in snap["evidence_a"] if e["type"] == "similarity" and e["similarity"] >= 0.99 and e["key"] in SIMILARITY_COPY], key=lambda e: -SIGNALS[e["key"]].similarity_weight)
    for e in sims:
        if len(reasons) >= 2:
            break
        key = e["key"]
        label, template = SIMILARITY_COPY[key]
        value_copy = VALUE_COPY.get(key, {}).get(e["viewer"], SIGNALS[key].options[e["viewer"]].lower())
        reasons.append({"label": label, "strength": _strength(me.confidences.get(key), other.confidences.get(key)), "text": template.format(value=value_copy), "evidence_ids": [f"signal:{key}"]})
        evidence_ids.append(f"signal:{key}")
    # 3. Practical availability
    overlaps = snap.get("availability_overlaps") or []
    if overlaps and len(reasons) < 3:
        days = sorted({o["weekday"] for o in overlaps})
        names = ", ".join(WEEKDAYS[d] for d in days[:3])
        reasons.append({"label": "Practical availability", "strength": "strong" if len(days) >= 2 else "promising", "text": f"Your availability overlaps on {names}, so a first date within two weeks is realistic.", "evidence_ids": ["availability:overlap"]})
        evidence_ids.append("availability:overlap")
    if snap.get("shared_languages") and len(reasons) < 3:
        langs = ", ".join(l.upper() for l in snap["shared_languages"])
        reasons.append({"label": "Shared language", "strength": "strong", "text": f"You share {langs}, so no translation is needed to get started.", "evidence_ids": ["profile:languages"]})
        evidence_ids.append("profile:languages")
    # Fill with weaker similarities if needed
    for e in sorted([e for e in snap["evidence_a"] if e["type"] == "similarity" and 0.4 <= e["similarity"] < 0.99 and e["key"] in SIMILARITY_COPY], key=lambda e: -e["similarity"]):
        if len(reasons) >= 3:
            break
        key = e["key"]
        label, _ = SIMILARITY_COPY[key]
        reasons.append({"label": label, "strength": "promising", "text": f"Your answers on {label.lower()} are close, though not identical.", "evidence_ids": [f"signal:{key}"]})
        evidence_ids.append(f"signal:{key}")
    reasons = reasons[:3]

    # Friction: the largest difference on a non-sensitive rhythm signal
    friction = None
    diffs = sorted([e for e in snap["evidence_a"] if e["type"] == "similarity" and e["similarity"] < 0.6 and e["key"] in FRICTION_COPY], key=lambda e: e["similarity"])
    if diffs:
        e = diffs[0]
        key = e["key"]
        mine = VALUE_COPY.get(key, {}).get(e["viewer"], SIGNALS[key].options[e["viewer"]].lower())
        theirs = VALUE_COPY.get(key, {}).get(e["subject"], SIGNALS[key].options[e["subject"]].lower())
        friction = {"text": FRICTION_COPY[key].format(name=other.display_name, other=theirs, mine=mine), "strength": _strength(me.confidences.get(key), other.confidences.get(key)), "evidence_ids": [f"signal:{key}"]}
    if friction is None:
        friction = {"text": "No clear tension shows in your confirmed answers, which usually means the real test is chemistry in person.", "strength": "low_evidence", "evidence_ids": []}

    # Unknown: a high value signal missing on either side, else the most uncertain
    unknown_key = next((k for k in snap.get("missing_signals", []) if k in UNKNOWN_COPY), None) or next((k for k in snap.get("low_evidence_signals", []) if k in UNKNOWN_COPY), None) or "interaction.planning_style"
    # The text is about the pair, so it keeps using the either-side key. The key list is not:
    # its one consumer is a form asking the viewer to supply or correct their own value, and
    # `missing_signals` is computed when *either* participant lacks a signal — right for the
    # uncertainty maths, wrong here. A gap on the other side is not the viewer's to fill, and
    # naming it led the form to promote a value of theirs that was perfectly fine, while the
    # signal they actually could have supplied was not offered at all.
    yours_to_fix = [k for k in snap.get("missing_signals", []) if k not in me.signals]
    yours_to_fix += [k for k in snap.get("low_evidence_signals", []) if k in me.signals and k not in yours_to_fix]
    unknown = {
        "text": UNKNOWN_COPY.get(unknown_key, "What a first meeting will feel like for both of you."),
        "strength": "low_evidence",
        "missing_signal_keys": yours_to_fix[:3],
    }

    categories = sorted({"blueprint"} | ({"availability"} if overlaps else set()) | ({"profile"} if snap.get("shared_languages") else set()))
    explanation = {"reasons": reasons, "friction": friction, "unknown": unknown, "evidence_ids": sorted(set(evidence_ids)), "data_categories": categories, "prohibited_inferences_used": False, "generator_version": GENERATOR_VERSION}
    validate_explanation(explanation, me, other)
    return explanation


def validate_explanation(explanation: dict[str, Any], me: Snapshot, other: Snapshot) -> None:
    """Deterministic validator: evidence references must exist, no prohibited topics, no numeric certainty."""
    known_keys = set(me.signals) | set(other.signals)
    for reason in explanation["reasons"] + [explanation["friction"]]:
        if PROHIBITED.search(reason["text"]):
            raise ValueError("explanation references a prohibited topic")
        if len(reason["text"]) > 240:
            raise ValueError("explanation too long")
        for ev in reason.get("evidence_ids", []):
            kind, _, key = ev.partition(":")
            if kind == "signal" and key not in known_keys:
                raise ValueError(f"evidence {ev} not in snapshot")
            if kind == "signal" and SIGNALS[key].special_category:
                raise ValueError("special category signal in explanation")
    if len(explanation["reasons"]) == 0:
        raise ValueError("explanation needs at least one reason")
