"""Weekly match batch: safety veto -> hard gates -> scoring -> allocation -> explanations -> review/publish."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.audit import audit
from app.core.config import get_settings
from app.core.events import publish
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.introductions import Introduction, MatchExplanation
from app.models.matching import CandidatePair, MatchRun
from app.modules.billing.service import entitlements_for, grant_credit
from app.modules.matching.allocation import allocate, exposure_stats
from app.modules.matching.eligibility import blocked_pairs, hard_gate, previously_introduced, restricted_members
from app.modules.matching.explanation import build_explanation
from app.modules.matching.scoring import score_pair
from app.modules.matching.snapshot import Snapshot, build_snapshot
from app.modules.notifications.service import notify

RULES_VERSION = "rules-2026-09.1"
MODEL_VERSION = "reciprocal-baseline-v0"


def pending_count(db: Session, member_id: str) -> int:
    from sqlalchemy import func

    return db.execute(select(func.count(Introduction.id)).where(or_(Introduction.member_a_id == member_id, Introduction.member_b_id == member_id), Introduction.status == "offered")).scalar() or 0


def active_conversations(db: Session, member_id: str) -> int:
    from sqlalchemy import func

    from app.models.conversations import Conversation

    return db.execute(select(func.count(Conversation.id)).where(or_(Conversation.member_a_id == member_id, Conversation.member_b_id == member_id), Conversation.status == "active")).scalar() or 0


def weekly_offered(db: Session, member_id: str) -> int:
    from sqlalchemy import func

    since = utcnow() - timedelta(days=7)
    return db.execute(select(func.count(Introduction.id)).where(or_(Introduction.member_a_id == member_id, Introduction.member_b_id == member_id), Introduction.offered_at >= since)).scalar() or 0


def capacity_for(db: Session, member: Member) -> int:
    settings = get_settings()
    ent = entitlements_for(db, member)
    if ent["paid"]:
        cap = ent["weekly_intro_cap"] - weekly_offered(db, member.id)
    else:
        cap = ent["trial_introductions_remaining"]
    cap = min(cap, settings.max_pending_introductions - pending_count(db, member.id))
    if active_conversations(db, member.id) >= settings.max_active_conversations:
        cap = 0
    return max(0, cap)


def run_batch(db: Session, market_id: str, triggered_by: str | None = None, auto_publish: bool = True) -> MatchRun:
    settings = get_settings()
    run = MatchRun(market_id=market_id, cohort_date=utcnow().date().isoformat(), rules_version=RULES_VERSION, model_version=MODEL_VERSION, triggered_by=triggered_by, config={"weekly_cap_paid": settings.weekly_intro_cap_paid, "weekly_cap_free": settings.trial_introductions, "auto_publish": auto_publish})
    db.add(run)
    db.flush()
    members = db.execute(select(Member).where(Member.status == "active", Member.market_id == market_id)).scalars().all()
    restricted = restricted_members(db)
    blocked = blocked_pairs(db)
    prior = previously_introduced(db)
    snapshots: dict[str, Snapshot] = {}
    caps: dict[str, int] = {}
    for m in members:
        if m.id in restricted:
            continue
        snap = build_snapshot(db, m)
        if snap is None or not snap.verified or not snap.signals or not snap.windows:
            continue
        snapshots[m.id] = snap
        caps[m.id] = capacity_for(db, m)
    ids = sorted(snapshots)
    edges: list[dict[str, Any]] = []
    gate_failures: dict[str, int] = {}
    eligible_members: set[str] = set()
    for i, a_id in enumerate(ids):
        for b_id in ids[i + 1 :]:
            if (a_id, b_id) in blocked or (a_id, b_id) in prior:
                continue
            ok, reason = hard_gate(snapshots[a_id], snapshots[b_id])
            if not ok:
                gate_failures[reason or "unknown"] = gate_failures.get(reason or "unknown", 0) + 1
                continue
            eligible_members.update((a_id, b_id))
            features = score_pair(snapshots[a_id], snapshots[b_id])
            edges.append({"a": a_id, "b": b_id, "score": features["pair_score"], "features": features})
    chosen = allocate(edges, caps)
    chosen_keys = {(e["a"], e["b"]) for e in chosen}
    # Persist every eligible edge for audit; mark allocated ones.
    rank_counter: dict[str, int] = {}
    for e in sorted(edges, key=lambda x: -x["score"]):
        rank_counter[e["a"]] = rank_counter.get(e["a"], 0) + 1
        rank_counter[e["b"]] = rank_counter.get(e["b"], 0) + 1
        f = e["features"]
        pair = CandidatePair(match_run_id=run.id, member_a_id=e["a"], member_b_id=e["b"], directional_a=f["directional_a"], directional_b=f["directional_b"], reciprocal=f["reciprocal"], practical=f["practical"], quality=f["quality"], uncertainty=f["uncertainty"], penalties=f["penalties"], pair_score=f["pair_score"], feature_snapshot=f["snapshot"], rank_for_a=rank_counter[e["a"]], rank_for_b=rank_counter[e["b"]], exposure_propensity=round(1.0 / max(1, min(rank_counter[e["a"]], rank_counter[e["b"]])), 3), allocated=(e["a"], e["b"]) in chosen_keys, review_status="pending" if (e["a"], e["b"]) in chosen_keys else "not_selected")
        db.add(pair)
        e["pair"] = pair
    db.flush()
    for e in chosen:
        pair = e["pair"]
        intro = Introduction(candidate_pair_id=pair.id, match_run_id=run.id, member_a_id=e["a"], member_b_id=e["b"], status="draft", is_trial_for=[mid for mid in (e["a"], e["b"]) if not entitlements_for(db, snapshots[mid].member)["paid"]])
        db.add(intro)
        db.flush()
        for me_id, other_id in ((e["a"], e["b"]), (e["b"], e["a"])):
            explanation = build_explanation(snapshots[me_id], snapshots[other_id], e["features"])
            db.add(MatchExplanation(introduction_id=intro.id, for_member_id=me_id, reasons=explanation["reasons"], friction=explanation["friction"], unknown=explanation["unknown"], evidence_ids=explanation["evidence_ids"], data_categories=explanation["data_categories"], generator_version=explanation["generator_version"], validated=True))
    stats = exposure_stats(chosen, eligible_members)
    unserved = [m for m in eligible_members if caps.get(m, 0) > 0 and m not in {x for e in chosen for x in (e["a"], e["b"])}]
    run.candidate_count = len(edges)
    run.allocation_count = len(chosen)
    run.stats = {**stats, "gate_failures": gate_failures, "pool": len(snapshots), "unserved_with_capacity": len(unserved)}
    run.status = "review"
    run.finished_at = utcnow()
    audit(db, actor_type="staff" if triggered_by else "system", actor_id=triggered_by, action="matching.run_completed", resource_type="match_run", resource_id=run.id, metadata={"edges": len(edges), "allocated": len(chosen)})
    if auto_publish:
        publish_run(db, run, reviewer_id=triggered_by)
    return run


def publish_run(db: Session, run: MatchRun, reviewer_id: str | None = None) -> int:
    settings = get_settings()
    intros = db.execute(select(Introduction).where(Introduction.match_run_id == run.id, Introduction.status == "draft")).scalars().all()
    published = 0
    served: set[str] = set()
    for intro in intros:
        pair = db.get(CandidatePair, intro.candidate_pair_id)
        if pair and pair.review_status == "rejected":
            intro.status = "withdrawn"
            intro.closed_reason = "concierge_rejected"
            continue
        if pair:
            pair.review_status = "published"
            pair.reviewer_id = pair.reviewer_id or reviewer_id
        intro.status = "offered"
        intro.offered_at = utcnow()
        intro.expires_at = utcnow() + timedelta(hours=settings.introduction_window_hours)
        intro.version += 1
        served.update((intro.member_a_id, intro.member_b_id))
        for mid in (intro.member_a_id, intro.member_b_id):
            notify(db, mid, "introduction_offered", "introductions", "A new introduction is ready", "Your matchmaker chose someone for you. Open the evidence before deciding.", f"/introductions/{intro.id}", dedupe_key=f"intro_offered:{intro.id}:{mid}")
            track(db, "introduction_offered", mid, intro_id=intro.id, run_id=run.id, rules_version=run.rules_version, model_version=run.model_version, rank=(pair.rank_for_a if mid == intro.member_a_id else pair.rank_for_b) if pair else None, propensity=pair.exposure_propensity if pair else None)
        publish(db, "introduction.offered", "introduction", intro.id, {"members": [intro.member_a_id, intro.member_b_id]}, dedupe_key=f"introduction.offered:{intro.id}")
        published += 1
    # Protected credits: paid, eligible, active members who received nothing this batch
    paid_members = db.execute(select(Member).where(Member.status == "active", Member.market_id == run.market_id)).scalars().all()
    for m in paid_members:
        if m.id in served:
            continue
        ent = entitlements_for(db, m)
        if ent["paid"] and pending_count(db, m.id) == 0 and weekly_offered(db, m.id) == 0:
            entry = grant_credit(db, m.id, 1, "no_qualified_inventory", reference=f"credit:{run.id}:{m.id}", match_run_id=run.id)
            if entry:
                notify(db, m.id, "protected_credit", "account", "Protected credit added", "We could not make a qualified introduction this week, so your membership is extended by one week. Your Must criteria were preserved.", "/introductions/waiting", dedupe_key=f"credit:{run.id}:{m.id}")
    run.status = "published"
    audit(db, actor_type="staff" if reviewer_id else "system", actor_id=reviewer_id, action="matching.run_published", resource_type="match_run", resource_id=run.id, metadata={"published": published})
    return published


def run_payload(run: MatchRun) -> dict[str, Any]:
    return {"id": run.id, "market_id": run.market_id, "cohort_date": run.cohort_date, "status": run.status, "rules_version": run.rules_version, "model_version": run.model_version, "candidate_count": run.candidate_count, "allocation_count": run.allocation_count, "stats": run.stats, "started_at": iso(run.started_at), "finished_at": iso(run.finished_at)}
