"""Constrained weekly allocation: per-member caps, exposure floor for qualified members, no repeats."""
from __future__ import annotations

from collections import defaultdict
from typing import Any


def allocate(edges: list[dict[str, Any]], caps: dict[str, int]) -> list[dict[str, Any]]:
    """edges: {a, b, score}. caps: member -> remaining introductions this batch. Returns chosen edges."""
    remaining = dict(caps)
    chosen: list[dict[str, Any]] = []
    used_pairs: set[tuple[str, str]] = set()
    by_member: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in edges:
        by_member[e["a"]].append(e)
        by_member[e["b"]].append(e)

    def take(e: dict[str, Any]) -> bool:
        key = (e["a"], e["b"])
        if key in used_pairs or remaining.get(e["a"], 0) <= 0 or remaining.get(e["b"], 0) <= 0:
            return False
        used_pairs.add(key)
        remaining[e["a"]] -= 1
        remaining[e["b"]] -= 1
        chosen.append(e)
        return True

    # Exposure floor: members with the fewest options are served first with their best edge.
    served: set[str] = set()
    for member in sorted(by_member, key=lambda m: (len(by_member[m]), m)):
        if member in served or remaining.get(member, 0) <= 0:
            continue
        for e in sorted(by_member[member], key=lambda x: -x["score"]):
            if take(e):
                served.update((e["a"], e["b"]))
                break
    # Fill remaining capacity by descending score.
    for e in sorted(edges, key=lambda x: -x["score"]):
        take(e)
    return chosen


def exposure_stats(chosen: list[dict[str, Any]], eligible_members: set[str]) -> dict[str, Any]:
    counts: dict[str, int] = defaultdict(int)
    for e in chosen:
        counts[e["a"]] += 1
        counts[e["b"]] += 1
    served = {m for m in eligible_members if counts[m] > 0}
    values = sorted(counts[m] for m in eligible_members)
    n = len(values)
    gini = 0.0
    if n and sum(values):
        cum = 0.0
        for i, v in enumerate(values, 1):
            cum += i * v
        gini = (2 * cum) / (n * sum(values)) - (n + 1) / n
    return {"eligible": len(eligible_members), "served": len(served), "coverage": round(len(served) / len(eligible_members), 3) if eligible_members else 0.0, "gini": round(gini, 3), "max_per_member": max(values) if values else 0}
