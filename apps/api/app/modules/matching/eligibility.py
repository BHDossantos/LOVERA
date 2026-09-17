"""Deterministic gates. Safety veto first, then bilateral hard constraints. Never relaxed by score or payment."""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.catalog.cities import zone_distance_km
from app.catalog.signals import PREFERENCES
from app.core.timeutil import utcnow
from app.models.account import Member
from app.models.blueprint import Preference
from app.models.introductions import Introduction
from app.models.safety import Block, SafetyAction
from app.modules.matching.snapshot import Snapshot, build_snapshot

COMPATIBLE_INTENTS = {("long_term", "long_term"), ("long_term", "life_partner"), ("life_partner", "life_partner"), ("life_partner", "long_term")}


def blocked_pairs(db: Session) -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for b in db.execute(select(Block).where(Block.removed_at.is_(None))).scalars():
        pairs.add((b.blocker_id, b.blocked_id))
        pairs.add((b.blocked_id, b.blocker_id))
    return pairs


def restricted_members(db: Session) -> set[str]:
    now = utcnow()
    out: set[str] = set()
    for a in db.execute(select(SafetyAction).where(SafetyAction.lifted_at.is_(None), SafetyAction.type.in_(("restrict", "suspend", "ban", "capability_limit")))).scalars():
        if a.active(now):
            out.add(a.subject_id)
    return out


def previously_introduced(db: Session) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    for i in db.execute(select(Introduction.member_a_id, Introduction.member_b_id)).all():
        out.add((i[0], i[1]))
        out.add((i[1], i[0]))
    return out


def candidate_pool(db: Session, member: Member) -> list[Member]:
    """Verified, active, onboarded members in the same market, excluding the member and blocked pairs."""
    rows = db.execute(select(Member).where(Member.status == "active", Member.market_id == member.market_id, Member.id != member.id)).scalars().all()
    blocked = blocked_pairs(db)
    restricted = restricted_members(db)
    return [m for m in rows if (member.id, m.id) not in blocked and m.id not in restricted]


def orientation_ok(a: Member, b: Member) -> bool:
    return bool(a.gender and b.gender and a.gender in (b.seeking or []) and b.gender in (a.seeking or []))


def preference_satisfied(pref: Preference, subject: Snapshot, viewer: Snapshot) -> bool | None:
    """True/False when the subject's data answers the preference; None when the signal is unknown."""
    pdef = PREFERENCES.get(pref.key)
    if pdef is None:
        return None
    if pdef.target == "member.age":
        if subject.age is None:
            return None
        return pref.value.get("min", 18) <= subject.age <= pref.value.get("max", 99)
    if pdef.target == "member.distance":
        km = zone_distance_km(viewer.member.home_zone_id, subject.member.home_zone_id)
        if km is None:
            return None
        return km <= pref.value.get("max", viewer.member.max_distance_km)
    if pdef.target == "profile.languages":
        wanted = pref.value.get("any_of", pref.value.get("in", []))
        if not wanted:
            return None
        return any(l in subject.languages for l in wanted)
    value = subject.signals.get(pdef.target)
    accepted = pref.value.get("in", [])
    if not accepted:
        return None
    if value is None:
        return None
    return value in accepted


def passes_hard_gate(db: Session, a: Member, b: Member, prefs_a: list[Preference] | None = None, snapshots: dict[str, Snapshot] | None = None) -> bool:
    snap_a = (snapshots or {}).get(a.id) or build_snapshot(db, a)
    snap_b = (snapshots or {}).get(b.id) or build_snapshot(db, b)
    if snap_a is None or snap_b is None:
        return False
    if prefs_a is not None:
        snap_a = Snapshot(**{**snap_a.__dict__, "preferences": prefs_a})
    ok, _ = hard_gate(snap_a, snap_b)
    return ok


def hard_gate(a: Snapshot, b: Snapshot) -> tuple[bool, str | None]:
    if not (a.verified and b.verified):
        return False, "verification"
    if a.age is None or b.age is None or a.age < 18 or b.age < 18:
        return False, "adult"
    if a.member.status != "active" or b.member.status != "active":
        return False, "account"
    if not orientation_ok(a.member, b.member):
        return False, "orientation"
    if (a.member.intent, b.member.intent) not in COMPATIBLE_INTENTS:
        return False, "intent"
    km = zone_distance_km(a.member.home_zone_id, b.member.home_zone_id)
    if km is None or km > min(a.member.max_distance_km, b.member.max_distance_km):
        return False, "geography"
    for viewer, subject in ((a, b), (b, a)):
        for pref in viewer.preferences:
            if pref.tier != "must":
                continue
            result = preference_satisfied(pref, subject, viewer)
            if result is False:
                return False, f"must:{pref.key}"
            if result is None and PREFERENCES[pref.key].target in ("life_plan.children", "life_plan.relationship_structure"):
                return False, f"must_unknown:{pref.key}"
    return True, None
