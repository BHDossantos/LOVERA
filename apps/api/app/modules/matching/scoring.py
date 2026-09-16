"""Reciprocal ranking. Scores stay internal; explanations use evidence labels, never numbers."""
from __future__ import annotations

from typing import Any

from app.catalog.cities import zone_distance_km
from app.catalog.signals import PREFERENCES, SIGNALS, TIER_WEIGHTS
from app.modules.matching.eligibility import preference_satisfied
from app.modules.matching.snapshot import Snapshot, is_fresh

EPS = 1e-6


def _minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def availability_overlap(a: Snapshot, b: Snapshot) -> tuple[float, list[dict[str, Any]]]:
    overlaps: list[dict[str, Any]] = []
    total = 0
    for wa in a.windows:
        for wb in b.windows:
            if wa["weekday"] != wb["weekday"]:
                continue
            start = max(_minutes(wa["start"]), _minutes(wb["start"]))
            end = min(_minutes(wa["end"]), _minutes(wb["end"]))
            if end - start >= 90:
                overlaps.append({"weekday": wa["weekday"], "start": f"{start // 60:02d}:{start % 60:02d}", "end": f"{end // 60:02d}:{end % 60:02d}"})
                total += end - start
    score = min(1.0, total / (3 * 180))  # three 3-hour overlaps is "plenty"
    return score, overlaps


def directional_fit(viewer: Snapshot, subject: Snapshot) -> tuple[float, list[dict[str, Any]]]:
    """How well the subject satisfies the viewer's weighted (non-Must) preferences plus similarity on rhythm signals."""
    weight_sum = 0.0
    score_sum = 0.0
    evidence: list[dict[str, Any]] = []
    for pref in viewer.preferences:
        if pref.tier == "must":
            continue
        w = TIER_WEIGHTS[pref.tier]
        result = preference_satisfied(pref, subject, viewer)
        if result is None:
            continue
        weight_sum += w
        score_sum += w if result else 0.0
        evidence.append({"type": "preference", "key": pref.key, "tier": pref.tier, "satisfied": result})
    for key, sig in SIGNALS.items():
        if sig.similarity_weight <= 0 or sig.special_category:
            continue
        va, vb = viewer.signals.get(key), subject.signals.get(key)
        if va is None or vb is None:
            continue
        options = list(sig.options)
        distance = abs(options.index(va) - options.index(vb)) / max(1, len(options) - 1)
        sim = 1.0 - distance
        weight_sum += sig.similarity_weight
        score_sum += sig.similarity_weight * sim
        evidence.append({"type": "similarity", "key": key, "viewer": va, "subject": vb, "similarity": round(sim, 2)})
    if weight_sum == 0:
        return 0.5, evidence
    return score_sum / weight_sum, evidence


def score_pair(a: Snapshot, b: Snapshot, repetition_penalty: float = 0.0, capacity_pressure: float = 0.0) -> dict[str, Any]:
    d_a, ev_a = directional_fit(a, b)
    d_b, ev_b = directional_fit(b, a)
    reciprocal = 2 * d_a * d_b / (d_a + d_b + EPS)
    avail, overlaps = availability_overlap(a, b)
    km = zone_distance_km(a.member.home_zone_id, b.member.home_zone_id) or 0.0
    max_km = max(1, min(a.member.max_distance_km, b.member.max_distance_km))
    distance_fit = max(0.0, 1.0 - km / max_km)
    shared_langs = sorted(set(a.languages) & set(b.languages))
    language_fit = 1.0 if shared_langs else 0.0
    practical = 0.5 * avail + 0.3 * distance_fit + 0.2 * language_fit
    freshness = 1.0 if (is_fresh(a) and is_fresh(b)) else 0.5
    completeness = (a.profile.completeness + b.profile.completeness) / 200
    readiness = 1.0 if (a.member.date_ready and b.member.date_ready) else 0.4
    quality = 0.4 * freshness + 0.3 * completeness + 0.3 * readiness
    low_evidence = [k for k, c in {**a.confidences, **b.confidences}.items() if c == "low_evidence"]
    high_value_keys = [k for k, s in SIGNALS.items() if s.similarity_weight >= 0.7]
    missing = [k for k in high_value_keys if k not in a.signals or k not in b.signals]
    uncertainty = min(0.3, 0.02 * len(low_evidence) + 0.03 * len(missing))
    penalties = {"uncertainty": round(uncertainty, 3), "stale_evidence": 0.0 if freshness == 1.0 else 0.05, "repetition": repetition_penalty, "capacity_pressure": capacity_pressure}
    pair_score = 0.60 * reciprocal + 0.25 * practical + 0.15 * quality - sum(penalties.values())
    return {
        "directional_a": round(d_a, 4),
        "directional_b": round(d_b, 4),
        "reciprocal": round(reciprocal, 4),
        "practical": round(practical, 4),
        "quality": round(quality, 4),
        "uncertainty": round(uncertainty, 4),
        "penalties": penalties,
        "pair_score": round(pair_score, 4),
        "snapshot": {
            "evidence_a": ev_a,
            "evidence_b": ev_b,
            "availability_overlaps": overlaps,
            "distance_km": round(km, 1),
            "shared_languages": shared_langs,
            "missing_signals": missing,
            "low_evidence_signals": low_evidence,
            "date_styles_a": a.date_styles,
            "date_styles_b": b.date_styles,
        },
    }
