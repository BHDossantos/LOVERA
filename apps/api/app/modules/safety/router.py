from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.models.safety import SafetyReport
from app.modules.safety import service

router = APIRouter(tags=["safety"])


class BlockIn(BaseModel):
    member_id: str


class ReportIn(BaseModel):
    subject_id: str | None = None
    category: str
    urgency: str = Field(default="not_urgent", pattern="^(happening_now|recent|past|not_urgent)$")
    narrative: str | None = Field(default=None, max_length=4000)
    conversation_id: str | None = None
    date_plan_id: str | None = None
    block_now: bool = True
    entry_surface: str = "safety_center"


class EvidenceIn(BaseModel):
    content_type: str
    size_bytes: int = 0
    checksum: str | None = None
    description: str | None = None
    data_url: str | None = Field(default=None, max_length=15_000_000)


class AppealIn(BaseModel):
    statement: str = Field(min_length=10, max_length=4000)


class CaseNoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


@router.get("/safety")
def center(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return service.safety_center(db, principal.member)


@router.get("/blocks")
def blocks(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return {"items": service.list_blocks(db, principal.id)}


@router.post("/blocks", status_code=201)
def block(data: BlockIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    b = service.create_block(db, principal.member, data.member_id)
    return {"blocked_member_id": b.blocked_id, "applied": True, "note": "Blocking is silent. The other member is not told who blocked them."}


@router.delete("/blocks/{member_id}", status_code=204)
def unblock(member_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> None:
    service.remove_block(db, principal.member, member_id)


@router.post("/safety/reports", status_code=201)
def report(data: ReportIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db), idempotency_key: str | None = Header(default=None)) -> dict:
    r = service.create_report(db, principal.member, data.subject_id, data.category, data.urgency, data.narrative, data.conversation_id, data.date_plan_id, data.block_now, idempotency_key, data.entry_surface)
    return service.case_payload(db, r, principal.id)


@router.post("/safety/reports/{report_id}/evidence", status_code=201)
def evidence(report_id: str, data: EvidenceIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    ev = service.add_evidence(db, principal.member, report_id, data.content_type, data.size_bytes, data.checksum, data.description, data.data_url)
    return {"evidence_id": ev.id, "retention": "Kept under the case retention policy with restricted access; every access is audited."}


@router.post("/safety/cases/{report_id}/notes", status_code=201)
def reporter_note(report_id: str, data: CaseNoteIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    from app.models.safety import CaseNote

    r = db.get(SafetyReport, report_id)
    if r is None or r.reporter_id != principal.id:
        raise ApiError("NOT_FOUND")
    db.add(CaseNote(report_id=r.id, author_id=principal.id, author_role="reporter", note=data.note, visible_to_reporter=True))
    return service.case_payload(db, r, principal.id)


@router.get("/safety/cases")
def cases(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return {"items": service.list_cases(db, principal.id)}


@router.get("/safety/cases/{report_id}")
def case(report_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    r = db.get(SafetyReport, report_id)
    if r is None or r.reporter_id != principal.id:
        raise ApiError("NOT_FOUND")
    return service.case_payload(db, r, principal.id)


@router.get("/account/review")
def account_review(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    return {"status": principal.member.status, "actions": service.my_actions(db, principal.id), "rights": ["Human review of any final adverse decision", "Export your data", "Delete your account", "Reporter identities are never disclosed"]}


@router.post("/account/review/{action_id}/appeal", status_code=201)
def appeal(action_id: str, data: AppealIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    a = service.create_appeal(db, principal.member, action_id, data.statement)
    return {"appeal_id": a.id, "status": a.status, "acknowledgment_target": "under 24 hours"}


@router.post("/safety/cases/{report_id}/appeal", status_code=201)
def appeal_by_case(report_id: str, data: AppealIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    """Spec path: subject member appeals the action attached to a case."""
    from sqlalchemy import select

    from app.models.safety import SafetyAction

    action = db.execute(select(SafetyAction).where(SafetyAction.report_id == report_id, SafetyAction.subject_id == principal.id, SafetyAction.appealable.is_(True))).scalars().first()
    if action is None:
        raise ApiError("NOT_FOUND")
    a = service.create_appeal(db, principal.member, action.id, data.statement)
    return {"appeal_id": a.id, "status": a.status}
