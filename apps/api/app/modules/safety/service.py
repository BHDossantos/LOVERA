"""Block, report, evidence, protective action, case status, appeal. Safety data never feeds matching."""
from __future__ import annotations

import secrets
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.analytics import track
from app.core.audit import audit
from app.core.datauri import AUDIO_TYPES, DOCUMENT_TYPES, IMAGE_TYPES, VIDEO_TYPES, decode_data_url
from app.core.errors import ApiError
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.conversations import Conversation
from app.models.dates import DatePlan
from app.models.introductions import Introduction
from app.models.safety import REPORT_CATEGORIES, Appeal, Block, CaseNote, SafetyAction, SafetyEvidence, SafetyReport
from app.modules.conversations.realtime import hub
from app.modules.notifications.service import notify

SPECIALIST = {"child_safety": "child_safety", "intimate_image_abuse": "ncii", "imminent_danger": "imminent_harm", "threats": "imminent_harm", "sexual_violence": "sexual_violence"}
EMERGENCY = {"rome": {"number": "112", "note": "Italy: 112 for police, medical and fire."}, "barcelona": {"number": "112", "note": "Spain: 112 for all emergencies."}}


def create_block(db: Session, blocker: Member, blocked_id: str, source: str = "member") -> Block:
    if blocked_id == blocker.id:
        raise ApiError("VALIDATION_ERROR", "You cannot block yourself.")
    if db.get(Member, blocked_id) is None:
        raise ApiError("NOT_FOUND")
    block = db.execute(select(Block).where(Block.blocker_id == blocker.id, Block.blocked_id == blocked_id)).scalar_one_or_none()
    if block and block.removed_at is None:
        return block
    if block:
        block.removed_at = None
        block.created_at = utcnow()
    else:
        block = Block(blocker_id=blocker.id, blocked_id=blocked_id, source=source)
        db.add(block)
    # Separate every surface immediately.
    for conv in db.execute(select(Conversation).where(or_((Conversation.member_a_id == blocker.id) & (Conversation.member_b_id == blocked_id), (Conversation.member_b_id == blocker.id) & (Conversation.member_a_id == blocked_id)))).scalars():
        if conv.status in ("active", "safety_hold"):
            conv.status = "blocked"
            conv.closed_at = utcnow()
            conv.close_reason = "unavailable"
        for plan in db.execute(select(DatePlan).where(DatePlan.conversation_id == conv.id, DatePlan.status.in_(("draft", "proposed", "countered", "confirmed")))).scalars():
            plan.status = "cancelled"
            plan.cancelled_at = utcnow()
            plan.cancel_reason = "unavailable"
        hub.push(blocked_id, {"type": "conversation.closed", "conversation_id": conv.id, "public_reason_code": "unavailable"})
    for intro in db.execute(select(Introduction).where(or_((Introduction.member_a_id == blocker.id) & (Introduction.member_b_id == blocked_id), (Introduction.member_b_id == blocker.id) & (Introduction.member_a_id == blocked_id)), Introduction.status.in_(("draft", "offered", "mutual")))).scalars():
        intro.status = "closed"
        intro.closed_reason = "unavailable"
        intro.version += 1
    db.flush()
    track(db, "protective_action_applied", blocker.id, action_type="block", automated=True)
    audit(db, actor_type="member", actor_id=blocker.id, action="safety.block", resource_type="member", resource_id=blocked_id, purpose="member_protection")
    return block


def remove_block(db: Session, blocker: Member, blocked_id: str) -> None:
    block = db.execute(select(Block).where(Block.blocker_id == blocker.id, Block.blocked_id == blocked_id, Block.removed_at.is_(None))).scalar_one_or_none()
    if block:
        block.removed_at = utcnow()  # Unblocking never restores prior contact or eligibility automatically.
        audit(db, actor_type="member", actor_id=blocker.id, action="safety.unblock", resource_type="member", resource_id=blocked_id)


def list_blocks(db: Session, member_id: str) -> list[dict[str, Any]]:
    from app.models.profile import Profile

    rows = db.execute(select(Block).where(Block.blocker_id == member_id, Block.removed_at.is_(None)).order_by(Block.created_at.desc())).scalars().all()
    out = []
    for b in rows:
        p = db.get(Profile, b.blocked_id)
        out.append({"member_id": b.blocked_id, "display_name": (p.display_name if p and p.display_name else "Member"), "created_at": iso(b.created_at)})
    return out


def create_report(db: Session, reporter: Member, subject_id: str | None, category: str, urgency: str, narrative: str | None, conversation_id: str | None, date_plan_id: str | None, block_now: bool, idempotency_key: str | None, entry_surface: str) -> SafetyReport:
    if idempotency_key:
        prior = db.execute(select(SafetyReport).where(SafetyReport.reporter_id == reporter.id, SafetyReport.idempotency_key == idempotency_key)).scalar_one_or_none()
        if prior:
            return prior
    if category not in REPORT_CATEGORIES:
        raise ApiError("VALIDATION_ERROR", "Choose a report category.", field_errors={"category": "unknown"})
    severity = REPORT_CATEGORIES[category]
    if urgency == "happening_now" and severity in ("P2", "P3"):
        severity = "P1"
    if subject_id and subject_id == reporter.id:
        raise ApiError("VALIDATION_ERROR", "Choose the member you are reporting.")
    track(db, "safety_report_started", reporter.id, entry_surface=entry_surface, category=category)
    report = SafetyReport(receipt_code=f"SC-{secrets.token_hex(3).upper()}", reporter_id=reporter.id, subject_id=subject_id, conversation_id=conversation_id, date_plan_id=date_plan_id, category=category, severity=severity, urgency=urgency, narrative=(narrative or "")[:4000] or None, status="submitted", specialist_workflow=SPECIALIST.get(category), idempotency_key=idempotency_key)
    db.add(report)
    db.flush()
    # Immediate protection in the same transaction.
    if subject_id:
        if block_now:
            create_block(db, reporter, subject_id, source="report")
        else:
            # Freeze the shared conversation without revealing who reported.
            for conv in db.execute(select(Conversation).where(or_((Conversation.member_a_id == reporter.id) & (Conversation.member_b_id == subject_id), (Conversation.member_b_id == reporter.id) & (Conversation.member_a_id == subject_id)), Conversation.status == "active")).scalars():
                if severity in ("P0", "P1", "P2"):
                    conv.safety_hold = True
                    conv.status = "safety_hold"
        db.add(SafetyAction(subject_id=subject_id, report_id=report.id, type="protective_block" if block_now else "capability_limit", scope="pair" if block_now else "conversation", reason_code=f"report:{category}", decision_source="rule", appealable=False, public_notice=None))
        if severity in ("P0", "P1"):
            db.add(SafetyAction(subject_id=subject_id, report_id=report.id, type="restrict", scope="discovery", reason_code=f"pending_review:{category}", decision_source="rule", appealable=True, public_notice="Your account is under review. You can still message existing connections, use safety tools and appeal."))
            subject = db.get(Member, subject_id)
            if subject and subject.status == "active":
                subject.status = "restricted"
        track(db, "protective_action_applied", reporter.id, action_type="protective_block" if block_now else "capability_limit", automated=True)
    report.status = "triaged"
    report.updated_at = utcnow()
    db.flush()
    track(db, "safety_report_submitted", reporter.id, category=category, severity=severity, evidence_count=0)
    audit(db, actor_type="member", actor_id=reporter.id, action="safety.report_created", resource_type="safety_report", resource_id=report.id, purpose="member_protection", metadata={"category": category, "severity": severity})
    notify(db, reporter.id, "report_receipt", "safety", f"Report received · {report.receipt_code}", "Protection is in place. You can track the case and add information from the Safety Center.", f"/safety/cases/{report.id}", dedupe_key=f"receipt:{report.id}")
    return report


def add_evidence(db: Session, reporter: Member, report_id: str, content_type: str, size_bytes: int, checksum: str | None, description: str | None, data_url: str | None) -> SafetyEvidence:
    report = db.get(SafetyReport, report_id)
    if report is None or report.reporter_id != reporter.id:
        raise ApiError("NOT_FOUND")
    if report.status == "closed":
        raise ApiError("CONFLICT", "This case is closed. Open a new report to add information.")
    # Validated before anything is stored, because what is stored is handed to a reviewer as an
    # image source. An unchecked string here let the reporter put a URL of their choosing in front
    # of the person handling a report about them — see app/core/datauri.py.
    if data_url:
        # Everything the pickers offer. A recording of a call and a saved chat log are evidence as
        # much as a screenshot is, and narrowing the server behind the client meant the member
        # attached a file, was told the report was filed, and the reviewer got nothing.
        decode_data_url(data_url, content_type, IMAGE_TYPES + VIDEO_TYPES + AUDIO_TYPES + DOCUMENT_TYPES)
    key = f"evidence/{report.id}/{secrets.token_hex(8)}"
    ev = SafetyEvidence(report_id=report.id, storage_key=key, content_type=content_type, size_bytes=size_bytes, checksum=checksum, description=(description or "")[:300] or None)
    db.add(ev)
    if data_url:
        from app.modules.profile.storage import put_object

        put_object(key, data_url)  # restricted bucket in production
    db.flush()
    audit(db, actor_type="member", actor_id=reporter.id, action="safety.evidence_added", resource_type="safety_report", resource_id=report.id, purpose="member_protection")
    return ev


def case_payload(db: Session, report: SafetyReport, viewer_id: str) -> dict[str, Any]:
    notes = db.execute(select(CaseNote).where(CaseNote.report_id == report.id, CaseNote.visible_to_reporter.is_(True)).order_by(CaseNote.created_at)).scalars().all()
    evidence_count = len(db.execute(select(SafetyEvidence.id).where(SafetyEvidence.report_id == report.id)).all())
    actions = db.execute(select(SafetyAction).where(SafetyAction.report_id == report.id)).scalars().all()
    protection = sorted({"contact_separated" if a.type in ("protective_block", "capability_limit") else "account_restricted" for a in actions})
    targets = {"P0": "Immediate escalation", "P1": "Continuous monitored queue", "P2": "Same-day review during staffed hours", "P3": "Within the published support window"}
    return {"id": report.id, "receipt_code": report.receipt_code, "category": report.category, "severity": report.severity, "status": report.status, "submitted_at": iso(report.submitted_at), "updated_at": iso(report.updated_at), "protection_applied": protection, "response_target": targets[report.severity], "evidence_count": evidence_count, "updates": [{"at": iso(n.created_at), "note": n.note} for n in notes], "resolution_code": report.resolution_code if report.status == "closed" else None, "support": {"emergency": EMERGENCY.get(db.get(Member, viewer_id).market_id, EMERGENCY["rome"]), "note": "We never contact the reported member with your identity."}}


def list_cases(db: Session, member_id: str) -> list[dict[str, Any]]:
    rows = db.execute(select(SafetyReport).where(SafetyReport.reporter_id == member_id).order_by(SafetyReport.submitted_at.desc())).scalars().all()
    return [case_payload(db, r, member_id) for r in rows]


def my_actions(db: Session, member_id: str) -> list[dict[str, Any]]:
    """Decision notices for the subject member. Never reveals the reporter."""
    now = utcnow()
    rows = db.execute(select(SafetyAction).where(SafetyAction.subject_id == member_id, SafetyAction.type.in_(("warning", "restrict", "suspend", "ban", "capability_limit"))).order_by(SafetyAction.created_at.desc())).scalars().all()
    out = []
    for a in rows:
        if not a.public_notice:
            continue
        appeal = db.execute(select(Appeal).where(Appeal.safety_action_id == a.id, Appeal.member_id == member_id)).scalar_one_or_none()
        out.append({"id": a.id, "type": a.type, "reason_category": a.reason_code.split(":")[-1], "notice": a.public_notice, "starts_at": iso(a.starts_at), "ends_at": iso(a.ends_at), "active": a.active(now), "decision_source": a.decision_source, "appealable": a.appealable and appeal is None, "appeal": {"id": appeal.id, "status": appeal.status, "outcome": appeal.outcome, "decided_at": iso(appeal.decided_at)} if appeal else None, "evidence_types": ["member report", "conversation context"]})
    return out


def create_appeal(db: Session, member: Member, action_id: str, statement: str) -> Appeal:
    action = db.get(SafetyAction, action_id)
    if action is None or action.subject_id != member.id:
        raise ApiError("NOT_FOUND")
    if not action.appealable:
        raise ApiError("CONFLICT", "This action is not appealable.")
    if db.execute(select(Appeal).where(Appeal.safety_action_id == action.id)).first():
        raise ApiError("CONFLICT", "An appeal is already open for this decision.")
    appeal = Appeal(safety_action_id=action.id, member_id=member.id, statement=statement[:4000])
    db.add(appeal)
    if action.report_id:
        report = db.get(SafetyReport, action.report_id)
        if report:
            report.status = "appealed"
    db.flush()
    days = (utcnow() - action.starts_at).days
    track(db, "appeal_submitted", member.id, action_type=action.type, days_since_action=days)
    audit(db, actor_type="member", actor_id=member.id, action="safety.appeal_created", resource_type="appeal", resource_id=appeal.id)
    notify(db, member.id, "appeal_receipt", "safety", "Appeal received", "A reviewer who did not make the original decision will look at it. Acknowledgment within 24 hours.", "/account/review", dedupe_key=f"appeal:{appeal.id}")
    return appeal


def safety_center(db: Session, member: Member) -> dict[str, Any]:
    return {
        "emergency": EMERGENCY.get(member.market_id, EMERGENCY["rome"]),
        "disclaimer": "This app is not an emergency service. If you are in immediate danger, contact local emergency services first.",
        "actions": [
            {"key": "report", "label": "Report someone", "path": "/safety/report"},
            {"key": "block", "label": "Blocked members", "path": "/safety/blocks"},
            {"key": "checkin", "label": "Date check-ins", "path": "/dates"},
            {"key": "cases", "label": "Your cases", "path": "/safety/cases"},
            {"key": "review", "label": "Account decisions and appeals", "path": "/account/review"},
        ],
        "education": [
            "Never send money, gift cards or crypto to someone you met here.",
            "Keep first dates public and tell a trusted contact.",
            "You can block without explaining. Blocking is silent.",
            "Reports stay private and never affect your matching.",
        ],
        "categories": [{"key": k, "severity": v} for k, v in REPORT_CATEGORIES.items()],
        "open_cases": len([c for c in list_cases(db, member.id) if c["status"] != "closed"]),
        "blocks": len(list_blocks(db, member.id)),
    }
