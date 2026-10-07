"""Staff workspaces. Every sensitive read requires a purpose and is audited. No direct data edits."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.db import get_db
from app.core.deps import Principal, require_roles
from app.core.errors import ApiError
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.billing import CreditLedger, Subscription
from app.models.conversations import Conversation, Message
from app.models.dates import DatePlan, PostDateFeedback
from app.models.introductions import IntroCorrection, IntroCorrectionReview, IntroDecision, Introduction, MatchExplanation
from app.models.matching import CandidatePair, MatchRun
from app.models.privacy import AnalyticsEvent, AuditEvent
from app.models.profile import Profile
from app.models.safety import Appeal, CaseNote, SafetyAction, SafetyEvidence, SafetyReport
from app.models.verification import Verification
from app.modules.matching import service as matching
from app.modules.notifications.service import notify

router = APIRouter(prefix="/admin", tags=["admin"])


class RunIn(BaseModel):
    market_id: str = "rome"
    auto_publish: bool = False


class PairReviewIn(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    note: str | None = Field(default=None, max_length=300)


class CorrectionReviewIn(BaseModel):
    decision: str = Field(pattern="^(actioned|no_change)$")
    note: str | None = Field(default=None, max_length=300)


class VerificationReviewIn(BaseModel):
    decision: str = Field(pattern="^(approve|recheck|reject)$")
    reason_code: str | None = None


class CaseUpdateIn(BaseModel):
    status: str | None = None
    note: str | None = Field(default=None, max_length=2000)
    visible_to_reporter: bool = False
    purpose: str = Field(default="case_review", min_length=3)


class ActionIn(BaseModel):
    type: str = Field(pattern="^(warning|capability_limit|restrict|suspend|ban|no_action)$")
    reason_code: str
    public_notice: str | None = Field(default=None, max_length=300)
    duration_days: int | None = None
    purpose: str = Field(default="case_decision", min_length=3)


class AppealDecisionIn(BaseModel):
    outcome: str = Field(pattern="^(upheld|overturned|modified)$")
    rationale_code: str


def _name(db: Session, member_id: str | None) -> str:
    if not member_id:
        return "—"
    p = db.get(Profile, member_id)
    return (p.display_name if p and p.display_name else member_id[:8])


def _review_payload(db: Session, review: IntroCorrectionReview) -> dict[str, Any]:
    """One correction's review, with the reviewer named rather than only identified.

    A concierge queue is worked by several people, so "reviewed, no change needed" is not a useful
    record unless the next person can see who decided it and ask them why. The id alone was no use
    to the client: there is no endpoint that turns a staff id into a person.
    """
    return {
        "decision": review.decision,
        "note": review.note,
        "reviewer": {"id": review.reviewer_id, "name": _name(db, review.reviewer_id)},
        "at": iso(review.created_at),
    }


# ---- Concierge matching -------------------------------------------------
@router.get("/matching/runs")
def list_runs(principal: Principal = Depends(require_roles("concierge", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    rows = db.execute(select(MatchRun).order_by(MatchRun.started_at.desc()).limit(20)).scalars().all()
    return {"items": [matching.run_payload(r) for r in rows]}


@router.post("/matching/runs", status_code=201)
def create_run(data: RunIn, principal: Principal = Depends(require_roles("concierge", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    run = matching.run_batch(db, data.market_id, triggered_by=principal.id, auto_publish=data.auto_publish)
    return matching.run_payload(run)


@router.get("/matching/runs/{run_id}/pairs")
def run_pairs(run_id: str, principal: Principal = Depends(require_roles("concierge", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    run = db.get(MatchRun, run_id)
    if run is None:
        raise ApiError("NOT_FOUND")
    pairs = db.execute(select(CandidatePair).where(CandidatePair.match_run_id == run_id, CandidatePair.allocated.is_(True)).order_by(CandidatePair.pair_score.desc())).scalars().all()
    audit(db, actor_type="staff", actor_id=principal.id, action="admin.pairs_viewed", resource_type="match_run", resource_id=run_id, purpose="concierge_review")
    out = []
    for p in pairs:
        intro = db.execute(select(Introduction).where(Introduction.candidate_pair_id == p.id)).scalar_one_or_none()
        explanations = db.execute(select(MatchExplanation).where(MatchExplanation.introduction_id == intro.id)).scalars().all() if intro else []
        out.append({"pair_id": p.id, "introduction_id": intro.id if intro else None, "member_a": {"id": p.member_a_id, "name": _name(db, p.member_a_id)}, "member_b": {"id": p.member_b_id, "name": _name(db, p.member_b_id)}, "scores": {"directional_a": p.directional_a, "directional_b": p.directional_b, "reciprocal": p.reciprocal, "practical": p.practical, "quality": p.quality, "pair_score": p.pair_score, "uncertainty": p.uncertainty}, "penalties": p.penalties, "rank_for_a": p.rank_for_a, "rank_for_b": p.rank_for_b, "review_status": p.review_status, "review_note": p.review_note, "explanations": [{"for": _name(db, e.for_member_id), "reasons": e.reasons, "friction": e.friction, "unknown": e.unknown} for e in explanations], "evidence": {"overlaps": p.feature_snapshot.get("availability_overlaps"), "distance_km": p.feature_snapshot.get("distance_km"), "shared_languages": p.feature_snapshot.get("shared_languages")}})
    return {"run": matching.run_payload(run), "items": out}


@router.post("/matching/pairs/{pair_id}/review")
def review_pair(pair_id: str, data: PairReviewIn, principal: Principal = Depends(require_roles("concierge", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    pair = db.get(CandidatePair, pair_id)
    if pair is None:
        raise ApiError("NOT_FOUND")
    pair.review_status = "approved" if data.decision == "approve" else "rejected"
    pair.reviewer_id = principal.id
    pair.review_note = data.note
    audit(db, actor_type="staff", actor_id=principal.id, action=f"admin.pair_{data.decision}", resource_type="candidate_pair", resource_id=pair.id, purpose="concierge_review", metadata={"note": data.note})
    return {"pair_id": pair.id, "review_status": pair.review_status}


@router.get("/matching/corrections")
def list_corrections(
    unapplied_only: bool = Query(False),
    unresolved_only: bool = Query(False),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    principal: Principal = Depends(require_roles("concierge", "admin")),
    db: Session = Depends(get_db, scope="function"),
) -> dict:
    """Corrections members filed against an introduction's explanation.

    These rows existed before this endpoint and were read by nothing, while the member was told
    "noted for a reviewer" — a promise no reviewer could keep. The useful ones are those with no
    replacement value: the member said an inference was wrong but could not say what the right
    answer is, so nothing about their matching changed and only a person can act on it.

    Paged, and with the reviewer's own decision in the payload, because the first version of this
    endpoint was a queue that could not drain: it took the newest 50 and had no offset and no
    notion of a correction having been dealt with, so past 50 unapplied rows the oldest disputed
    signals were permanently unreachable while still affecting matching. `total` is the size of
    the filtered set, so a caller can tell there is more behind what it asked for.

    The filtering, the count and the page are all SQL. The version before this one read every
    correction ever filed, then looked up reviews with every one of those ids in a single `IN`, and
    only then cut the page in Python — so a queue nobody ever deletes from got slower and heavier
    with its own history, and a long enough one would have passed more bind parameters than the
    driver accepts and taken every page down with it.
    """
    from app.catalog.signals import SIGNALS

    # `applied` is whether the member supplied a replacement value. `corrected_value` is JSONB and
    # the writer always stores `{"value": <str|None>}` (introductions/service.py), so this is the
    # same predicate as `bool(value)` — null and the empty string are the only falsy cases.
    value = IntroCorrection.corrected_value["value"].astext
    applied_sql = and_(value.isnot(None), value != "")
    reviewed_sql = select(IntroCorrectionReview.id).where(IntroCorrectionReview.correction_id == IntroCorrection.id).exists()

    where = []
    if unapplied_only:
        where.append(~applied_sql)
    if unresolved_only:
        where.extend([~applied_sql, ~reviewed_sql])

    total = db.execute(select(func.count()).select_from(IntroCorrection).where(*where)).scalar_one()
    rows = (
        db.execute(
            select(IntroCorrection)
            .where(*where)
            .order_by(IntroCorrection.created_at.desc(), IntroCorrection.id.desc())
            .offset(offset)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    reviews = (
        {
            r.correction_id: r
            for r in db.execute(select(IntroCorrectionReview).where(IntroCorrectionReview.correction_id.in_([c.id for c in rows]))).scalars().all()
        }
        if rows
        else {}
    )

    out = []
    for c in rows:
        applied = bool((c.corrected_value or {}).get("value"))
        sig = SIGNALS.get(c.signal_key)
        review = reviews.get(c.id)
        out.append(
            {
                "id": c.id,
                "introduction_id": c.introduction_id,
                "member": {"id": c.member_id, "name": _name(db, c.member_id)},
                "signal_key": c.signal_key,
                "signal_label": sig.label if sig else c.signal_key,
                "corrected_value": (c.corrected_value or {}).get("value"),
                # False means the member's Blueprint was left as it was: they disputed the
                # inference without supplying a replacement, so this row is the only record.
                "applied": applied,
                "note": c.note,
                "created_at": iso(c.created_at),
                "review": None if review is None else _review_payload(db, review),
            }
        )
    audit(db, actor_type="staff", actor_id=principal.id, action="admin.corrections_viewed", resource_type="intro_correction", resource_id=None, purpose="concierge_review", metadata={"count": len(out)})
    return {"items": out, "total": total, "limit": limit, "offset": offset}


@router.post("/matching/corrections/{correction_id}/review")
def review_correction(
    correction_id: str,
    data: CorrectionReviewIn,
    principal: Principal = Depends(require_roles("concierge", "admin")),
    db: Session = Depends(get_db, scope="function"),
) -> dict:
    """Resolve one correction, so the unresolved queue has a way out.

    A correction the member filed without a replacement value changes nothing on its own: the
    member is told it has been noted for a reviewer, and this is the endpoint by which a reviewer
    says they have done that. It does not touch the member's blueprint — a signal is changed
    through the blueprint endpoints, which audit it in the member's own name — it records that a
    person has handled this row.
    """
    correction = db.get(IntroCorrection, correction_id)
    if correction is None:
        raise ApiError("NOT_FOUND")
    review = IntroCorrectionReview(correction_id=correction.id, reviewer_id=principal.id, decision=data.decision, note=data.note)
    # The unique constraint decides this, not a preceding SELECT. Two reviewers working the same
    # queue — which is the normal way a queue gets worked — would both pass a check-then-insert
    # before either wrote, and the loser got a 500 from the IntegrityError instead of the conflict
    # this endpoint promises. Now there is one path for both, and the sequential second reviewer
    # exercises the same code as the concurrent one.
    #
    # The savepoint keeps the failure local: without it a caught IntegrityError leaves the whole
    # transaction unusable, so the handler ending the request would be the only thing between this
    # and a poisoned session for anything added after it.
    try:
        with db.begin_nested():
            db.add(review)
            db.flush()
    except IntegrityError:
        raise ApiError("CONFLICT", "Another reviewer has already resolved this correction.")
    audit(
        db,
        actor_type="staff",
        actor_id=principal.id,
        action="admin.correction_reviewed",
        resource_type="intro_correction",
        resource_id=correction.id,
        purpose="concierge_review",
        metadata={"decision": data.decision, "note": data.note, "signal_key": correction.signal_key},
    )
    return {"id": correction.id, "review": _review_payload(db, review)}


@router.post("/matching/runs/{run_id}/publish")
def publish_run(run_id: str, principal: Principal = Depends(require_roles("concierge", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    run = db.get(MatchRun, run_id)
    if run is None:
        raise ApiError("NOT_FOUND")
    if run.status == "published":
        raise ApiError("CONFLICT", "This run is already published.")
    published = matching.publish_run(db, run, reviewer_id=principal.id)
    return {"run_id": run.id, "published": published, "status": run.status}


@router.get("/marketplace")
def marketplace(principal: Principal = Depends(require_roles("concierge", "admin", "support")), db: Session = Depends(get_db, scope="function")) -> dict:
    members = db.execute(select(Member).where(Member.status.in_(("active", "paused", "onboarding", "pending_verification", "restricted")))).scalars().all()
    by_status: dict[str, int] = {}
    by_gender: dict[str, int] = {}
    for m in members:
        by_status[m.status] = by_status.get(m.status, 0) + 1
        if m.status == "active":
            by_gender[m.gender or "unknown"] = by_gender.get(m.gender or "unknown", 0) + 1
    intro_counts = dict(db.execute(select(Introduction.status, func.count(Introduction.id)).group_by(Introduction.status)).all())
    paid = db.execute(select(func.count(Subscription.id)).where(Subscription.status == "active")).scalar() or 0
    credits = db.execute(select(func.coalesce(func.sum(CreditLedger.amount), 0))).scalar() or 0
    funnel = {
        "introductions_offered": sum(v for k, v in intro_counts.items() if k != "draft"),
        "mutual": intro_counts.get("mutual", 0),
        "dates_confirmed": db.execute(select(func.count(DatePlan.id)).where(DatePlan.status.in_(("confirmed", "completed", "no_show", "disputed")))).scalar() or 0,
        "dates_completed": db.execute(select(func.count(DatePlan.id)).where(DatePlan.status == "completed")).scalar() or 0,
        "mutual_second_dates": (db.execute(select(func.count(PostDateFeedback.id)).where(PostDateFeedback.reveal_state == "revealed_mutual")).scalar() or 0) // 2,
        "p0_p1_reports": db.execute(select(func.count(SafetyReport.id)).where(SafetyReport.severity.in_(("P0", "P1")))).scalar() or 0,
    }
    active = by_status.get("active", 0)
    funnel["north_star_per_100_active"] = round(100 * funnel["mutual_second_dates"] / active, 1) if active else 0.0
    latest = db.execute(select(MatchRun).order_by(MatchRun.started_at.desc()).limit(1)).scalar_one_or_none()
    return {"members_by_status": by_status, "active_by_gender": by_gender, "balance_warning": _balance_warning(by_gender), "introductions_by_status": intro_counts, "paid_members": paid, "credits_granted": credits, "funnel": funnel, "latest_run": matching.run_payload(latest) if latest else None, "queues": {"verification_review": db.execute(select(func.count(Verification.id)).where(Verification.status == "review_required")).scalar() or 0, "safety_open": db.execute(select(func.count(SafetyReport.id)).where(SafetyReport.status != "closed")).scalar() or 0, "appeals_open": db.execute(select(func.count(Appeal.id)).where(Appeal.status != "decided")).scalar() or 0}}


def _balance_warning(by_gender: dict[str, int]) -> str | None:
    total = sum(by_gender.values())
    if total < 4:
        return None
    worst = max(by_gender.values()) / total
    return "Core cohort worse than 60/40. Pause acquisition for the oversupplied side." if worst > 0.6 else None


# ---- Verification review --------------------------------------------------
@router.get("/verification/queue")
def verification_queue(principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    rows = db.execute(select(Verification).where(Verification.status.in_(("review_required", "failed"))).order_by(Verification.created_at)).scalars().all()
    return {"items": [{"id": v.id, "member_name": _name(db, v.member_id), "status": v.status, "failure_reason_code": v.failure_reason_code, "review_note": v.review_note, "created_at": iso(v.created_at)} for v in rows]}


@router.post("/verification/{verification_id}/review")
def verification_review(verification_id: str, data: VerificationReviewIn, principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    from app.modules.verification.service import apply_result

    v = db.get(Verification, verification_id)
    if v is None:
        raise ApiError("NOT_FOUND")
    if data.decision == "approve":
        apply_result(db, v.provider_ref, {"outcome": "verified", "age_over_18": True, "liveness_passed": True}, source="staff")
    elif data.decision == "reject":
        apply_result(db, v.provider_ref, {"outcome": "failed", "age_over_18": v.age_over_18, "liveness_passed": v.liveness_passed, "reason_code": data.reason_code or "rejected_after_review"}, source="staff")
    else:
        v.status = "in_progress"
    audit(db, actor_type="staff", actor_id=principal.id, action=f"admin.verification_{data.decision}", resource_type="verification", resource_id=v.id, purpose="verification_review")
    return {"id": v.id, "status": v.status}


# ---- Safety cases ---------------------------------------------------------
@router.get("/safety/cases")
def safety_cases(principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function"), status: str | None = Query(default=None)) -> dict:
    q = select(SafetyReport).order_by(SafetyReport.severity, SafetyReport.submitted_at)
    if status:
        q = q.where(SafetyReport.status == status)
    else:
        q = q.where(SafetyReport.status != "closed")
    rows = db.execute(q).scalars().all()
    return {"items": [{"id": r.id, "receipt_code": r.receipt_code, "severity": r.severity, "category": r.category, "status": r.status, "urgency": r.urgency, "specialist_workflow": r.specialist_workflow, "submitted_at": iso(r.submitted_at), "assigned": r.assigned_reviewer_id == principal.id} for r in rows]}


@router.get("/safety/cases/{report_id}")
def safety_case(report_id: str, principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function"), purpose: str = Query(min_length=3)) -> dict:
    r = db.get(SafetyReport, report_id)
    if r is None:
        raise ApiError("NOT_FOUND")
    audit(db, actor_type="staff", actor_id=principal.id, action="admin.case_opened", resource_type="safety_report", resource_id=r.id, purpose=purpose)
    evidence = db.execute(select(SafetyEvidence).where(SafetyEvidence.report_id == r.id)).scalars().all()
    for e in evidence:
        e.access_count += 1
    notes = db.execute(select(CaseNote).where(CaseNote.report_id == r.id).order_by(CaseNote.created_at)).scalars().all()
    actions = db.execute(select(SafetyAction).where(SafetyAction.report_id == r.id)).scalars().all()
    context = []
    if r.conversation_id:
        msgs = db.execute(select(Message).where(Message.conversation_id == r.conversation_id).order_by(Message.sequence.desc()).limit(20)).scalars().all()
        context = [{"from": "reporter" if m.sender_id == r.reporter_id else "subject", "text": m.body, "at": iso(m.sent_at), "flags": (m.meta or {}).get("flags", [])} for m in reversed(msgs)]
        audit(db, actor_type="staff", actor_id=principal.id, action="admin.conversation_context_viewed", resource_type="conversation", resource_id=r.conversation_id, purpose=purpose)
    return {"id": r.id, "receipt_code": r.receipt_code, "severity": r.severity, "category": r.category, "urgency": r.urgency, "status": r.status, "specialist_workflow": r.specialist_workflow, "narrative": r.narrative, "reporter": {"id": r.reporter_id, "name": _name(db, r.reporter_id)}, "subject": {"id": r.subject_id, "name": _name(db, r.subject_id), "status": db.get(Member, r.subject_id).status if r.subject_id else None}, "evidence": [{"id": e.id, "content_type": e.content_type, "description": e.description, "collected_at": iso(e.collected_at), "access_count": e.access_count} for e in evidence], "notes": [{"id": n.id, "role": n.author_role, "note": n.note, "visible_to_reporter": n.visible_to_reporter, "at": iso(n.created_at)} for n in notes], "actions": [{"id": a.id, "type": a.type, "scope": a.scope, "reason_code": a.reason_code, "decision_source": a.decision_source, "appealable": a.appealable, "public_notice": a.public_notice, "ends_at": iso(a.ends_at), "lifted_at": iso(a.lifted_at)} for a in actions], "conversation_context": context, "submitted_at": iso(r.submitted_at)}


@router.get("/safety/evidence/{evidence_id}")
def safety_evidence(
    evidence_id: str,
    principal: Principal = Depends(require_roles("safety_reviewer", "admin")),
    db: Session = Depends(get_db, scope="function"),
    purpose: str = Query(min_length=3),
) -> dict:
    """The bytes of one piece of evidence, for the person handling the case.

    The upload endpoint answers a reporter with "Kept under the case retention policy with
    restricted access; every access is audited", and the case page lists each attachment's MIME
    type and description. Neither was a way to open it: the screenshot a member attached — often
    the whole substance of a report, a threat or a demand for money — was stored and could be read
    by nobody. A reporter was being asked to send evidence into a vault with no door.

    Same shape as the member-facing media read: a declared purpose, an audit row naming this
    reviewer and this attachment, and the access counted on the row itself so the case page shows
    how often it has been opened.
    """
    ev = db.get(SafetyEvidence, evidence_id)
    if ev is None:
        raise ApiError("NOT_FOUND")
    from app.modules.profile.storage import get_object

    data_url = get_object(ev.storage_key)
    if not data_url:
        # Metadata without bytes: an upload that never completed, or retention has expired. Not an
        # error the reviewer can act on, so it says which rather than reading as a missing case.
        raise ApiError("NOT_FOUND", "This attachment is no longer in the vault.")
    ev.access_count += 1
    audit(
        db,
        actor_type="staff",
        actor_id=principal.id,
        action="admin.evidence_opened",
        resource_type="safety_evidence",
        resource_id=ev.id,
        purpose=purpose,
        metadata={"report_id": ev.report_id, "content_type": ev.content_type},
    )
    return {
        "id": ev.id,
        "report_id": ev.report_id,
        "content_type": ev.content_type,
        "description": ev.description,
        "size_bytes": ev.size_bytes,
        "checksum": ev.checksum,
        "collected_at": iso(ev.collected_at),
        "access_count": ev.access_count,
        "data_url": data_url,
    }


@router.post("/safety/cases/{report_id}")
def update_case(report_id: str, data: CaseUpdateIn, principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    r = db.get(SafetyReport, report_id)
    if r is None:
        raise ApiError("NOT_FOUND")
    if data.status:
        if data.status not in ("triaged", "assigned", "in_review", "actioned", "awaiting_information", "closed"):
            raise ApiError("VALIDATION_ERROR", "Unknown case status.")
        r.status = data.status
        r.assigned_reviewer_id = principal.id if data.status in ("assigned", "in_review") else r.assigned_reviewer_id
        if data.status == "closed":
            r.closed_at = utcnow()
            r.resolution_code = r.resolution_code or "reviewed"
            notify(db, r.reporter_id, "case_closed", "safety", f"Case {r.receipt_code} resolved", "Thank you for reporting. Protective measures stay in place.", f"/safety/cases/{r.id}", dedupe_key=f"case_closed:{r.id}")
    if data.note:
        db.add(CaseNote(report_id=r.id, author_id=principal.id, author_role="reviewer", note=data.note, visible_to_reporter=data.visible_to_reporter))
        if data.visible_to_reporter:
            notify(db, r.reporter_id, "case_update", "safety", f"Update on case {r.receipt_code}", data.note[:200], f"/safety/cases/{r.id}", dedupe_key=f"case_note:{r.id}:{utcnow().timestamp()}")
    r.updated_at = utcnow()
    audit(db, actor_type="staff", actor_id=principal.id, action="admin.case_updated", resource_type="safety_report", resource_id=r.id, purpose=data.purpose, metadata={"status": data.status})
    return {"id": r.id, "status": r.status}


@router.post("/safety/cases/{report_id}/actions", status_code=201)
def create_action(report_id: str, data: ActionIn, principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    from datetime import timedelta

    r = db.get(SafetyReport, report_id)
    if r is None or not r.subject_id:
        raise ApiError("NOT_FOUND")
    subject = db.get(Member, r.subject_id)
    if data.type == "no_action":
        for a in db.execute(select(SafetyAction).where(SafetyAction.report_id == r.id, SafetyAction.type == "restrict", SafetyAction.lifted_at.is_(None))).scalars():
            a.lifted_at = utcnow()
        if subject and subject.status == "restricted":
            from app.modules.account.service import active_restrictions, advance_onboarding

            if not [x for x in active_restrictions(db, subject.id) if x.type in ("restrict", "suspend", "ban")]:
                subject.status = "active"
                advance_onboarding(db, subject)
        r.status, r.resolution_code = "closed", "no_violation"
        r.closed_at = utcnow()
        action = None
    else:
        action = SafetyAction(subject_id=r.subject_id, report_id=r.id, type=data.type, scope="account", reason_code=data.reason_code, decision_source="human", reviewer_id=principal.id, appealable=True, public_notice=data.public_notice or f"A reviewer applied a {data.type.replace('_', ' ')} to your account under the community agreement.", ends_at=(utcnow() + timedelta(days=data.duration_days)) if data.duration_days else None)
        db.add(action)
        db.flush()
        if data.type in ("restrict", "suspend", "ban") and subject:
            subject.status = "restricted"
        r.status = "actioned"
        r.resolution_code = data.type
        notify(db, r.subject_id, "account_decision", "safety", "A decision about your account", action.public_notice, "/account/review", dedupe_key=f"decision:{action.id}")
    r.updated_at = utcnow()
    audit(db, actor_type="staff", actor_id=principal.id, action=f"admin.action_{data.type}", resource_type="safety_report", resource_id=r.id, purpose=data.purpose, metadata={"reason_code": data.reason_code})
    return {"report_id": r.id, "action_id": action.id if action else None, "status": r.status}


@router.get("/safety/appeals")
def appeals(principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    rows = db.execute(select(Appeal).where(Appeal.status != "decided").order_by(Appeal.created_at)).scalars().all()
    out = []
    for a in rows:
        action = db.get(SafetyAction, a.safety_action_id)
        out.append({"id": a.id, "status": a.status, "member_name": _name(db, a.member_id), "action_type": action.type if action else None, "original_reviewer_id": action.reviewer_id if action else None, "can_review": bool(action and action.reviewer_id != principal.id), "created_at": iso(a.created_at)})
    return {"items": out}


@router.get("/safety/appeals/{appeal_id}")
def appeal_detail(appeal_id: str, principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function"), purpose: str = Query(min_length=3)) -> dict:
    a = db.get(Appeal, appeal_id)
    if a is None:
        raise ApiError("NOT_FOUND")
    action = db.get(SafetyAction, a.safety_action_id)
    audit(db, actor_type="staff", actor_id=principal.id, action="admin.appeal_opened", resource_type="appeal", resource_id=a.id, purpose=purpose)
    return {"id": a.id, "status": a.status, "statement": a.statement, "member_name": _name(db, a.member_id), "action": {"id": action.id, "type": action.type, "reason_code": action.reason_code, "public_notice": action.public_notice, "reviewer_id": action.reviewer_id, "report_id": action.report_id} if action else None, "independent_review_ok": bool(action and action.reviewer_id != principal.id), "created_at": iso(a.created_at)}


@router.post("/safety/appeals/{appeal_id}/decide")
def decide_appeal(appeal_id: str, data: AppealDecisionIn, principal: Principal = Depends(require_roles("safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function")) -> dict:
    a = db.get(Appeal, appeal_id)
    if a is None:
        raise ApiError("NOT_FOUND")
    action = db.get(SafetyAction, a.safety_action_id)
    if action and action.reviewer_id == principal.id:
        raise ApiError("FORBIDDEN", "Appeals must be decided by a reviewer who did not make the original decision.")
    a.status, a.outcome, a.rationale_code, a.assigned_reviewer_id, a.decided_at = "decided", data.outcome, data.rationale_code, principal.id, utcnow()
    if data.outcome in ("overturned", "modified") and action:
        action.lifted_at = utcnow()
        subject = db.get(Member, a.member_id)
        from app.modules.account.service import active_restrictions, advance_onboarding

        if subject and subject.status == "restricted" and not [x for x in active_restrictions(db, subject.id) if x.type in ("restrict", "suspend", "ban")]:
            subject.status = "active"
            advance_onboarding(db, subject)
    notify(db, a.member_id, "appeal_decided", "safety", "Your appeal was reviewed", {"upheld": "The decision stands after independent review.", "overturned": "The decision was overturned and the restriction lifted.", "modified": "The decision was modified. See account review for details."}[data.outcome], "/account/review", dedupe_key=f"appeal_decided:{a.id}")
    audit(db, actor_type="staff", actor_id=principal.id, action=f"admin.appeal_{data.outcome}", resource_type="appeal", resource_id=a.id, purpose="appeal_review", metadata={"rationale_code": data.rationale_code})
    return {"id": a.id, "outcome": a.outcome}


# ---- Support and audit ----------------------------------------------------
@router.get("/members")
def members(principal: Principal = Depends(require_roles("support", "concierge", "safety_reviewer", "admin")), db: Session = Depends(get_db, scope="function"), q: str | None = None) -> dict:
    query = select(Member).order_by(Member.created_at.desc()).limit(50)
    if q:
        query = query.where(Member.email.ilike(f"%{q}%"))
    rows = db.execute(query).scalars().all()
    return {"items": [{"id": m.id, "name": _name(db, m.id), "email": m.email if principal.has_role("support", "admin") else None, "status": m.status, "onboarding_step": m.onboarding_step, "market": m.market_id, "roles": m.roles, "created_at": iso(m.created_at)} for m in rows]}


@router.get("/audit")
def audit_log(principal: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db, scope="function"), resource_type: str | None = None) -> dict:
    q = select(AuditEvent).order_by(AuditEvent.occurred_at.desc()).limit(100)
    if resource_type:
        q = q.where(AuditEvent.resource_type == resource_type)
    rows = db.execute(q).scalars().all()
    return {"items": [{"id": e.id, "actor_type": e.actor_type, "actor_id": e.actor_id, "action": e.action, "resource_type": e.resource_type, "resource_id": e.resource_id, "purpose": e.purpose, "metadata": e.redacted_metadata, "occurred_at": iso(e.occurred_at), "hash": e.hash} for e in rows]}


@router.get("/analytics/events")
def analytics_events(principal: Principal = Depends(require_roles("admin", "concierge")), db: Session = Depends(get_db, scope="function")) -> dict:
    rows = db.execute(select(AnalyticsEvent.event, func.count(AnalyticsEvent.id)).group_by(AnalyticsEvent.event)).all()
    return {"counts": {k: v for k, v in rows}}
