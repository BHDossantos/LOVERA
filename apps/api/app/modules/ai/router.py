"""AI Wingman drafts and translation previews. Every output is a draft; the send endpoint is separate and member initiated."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.gateway import AIUnavailable
from app.ai.tasks import ValidationFailed, generate_draft, translate
from app.core.analytics import track
from app.core.audit import audit
from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.core.timeutil import iso
from app.models.account import Member
from app.models.ai import AIDraft, Translation
from app.models.conversations import Message
from app.models.profile import Profile
from app.modules.billing.service import entitlements_for
from app.modules.conversations.service import get_conversation

router = APIRouter(prefix="/conversations", tags=["ai"])


class DraftIn(BaseModel):
    mode: str = Field(default="natural", pattern="^(natural|warm|playful|direct)$")
    goal: str = Field(default="respond", pattern="^(opener|respond|suggest_public_date|reconnect)$")
    context_message_ids: list[str] = []
    language: str = Field(default="en", pattern="^(en|it|es|pt)$")


class TranslateIn(BaseModel):
    text: str | None = Field(default=None, max_length=2000)
    message_id: str | None = None
    source_lang: str = Field(pattern="^(en|it|es|pt)$")
    target_lang: str = Field(pattern="^(en|it|es|pt)$")


def _require_paid(db: Session, member: Member, capability: str) -> None:
    ent = entitlements_for(db, member)
    if not ent.get(capability):
        raise ApiError("FORBIDDEN", "AI Wingman and translation are part of Matchmaker Pro. Manual messaging is always free.", extra={"capability": capability})


@router.post("/{conv_id}/ai-drafts")
def create_draft(conv_id: str, data: DraftIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    conv = get_conversation(db, conv_id, principal.id)
    if conv.status != "active":
        raise ApiError("CONFLICT", "This conversation has ended.")
    _require_paid(db, principal.member, "ai_wingman")
    other = db.get(Member, conv.other(principal.id))
    other_profile = db.get(Profile, other.id)
    my_profile = db.get(Profile, principal.id)
    recent = db.execute(select(Message).where(Message.conversation_id == conv.id, Message.deleted_at.is_(None)).order_by(Message.sequence.desc()).limit(6)).scalars().all()
    recent = list(reversed(recent))
    # Context minimisation: only recent message text, display names and member-authored prompt answers.
    shared_facts = [p["answer"] for p in (other_profile.prompts or []) if p.get("answer")][:2]
    payload = {
        "mode": data.mode,
        "goal": data.goal,
        "language": data.language,
        "my_display_name": my_profile.display_name or "Me",
        "other_display_name": other_profile.display_name or "them",
        "recent_messages": [{"from": "me" if m.sender_id == principal.id else "them", "text": m.body[:400]} for m in recent],
        "shared_facts": shared_facts,
        "suggested_venue": None,
        "suggested_window": None,
    }
    if data.goal == "suggest_public_date":
        from app.modules.dates.service import suggest_for_draft

        venue, window = suggest_for_draft(db, conv, principal.member)
        payload["suggested_venue"], payload["suggested_window"] = venue, window
    try:
        text, labels, model_version = generate_draft(payload)
    except AIUnavailable:
        raise ApiError("AI_UNAVAILABLE", "The writing assistant is unavailable right now. You can still write and send your own message.", retryable=True)
    except ValidationFailed:
        raise ApiError("AI_UNAVAILABLE", "The assistant produced a draft that failed our safety check. Try again or write your own message.", retryable=True)
    draft = AIDraft(conversation_id=conv.id, requester_id=principal.id, mode=data.mode, goal=data.goal, context_message_ids=[m.id for m in recent], draft_text=text, model_version=model_version, safety_labels=labels)
    db.add(draft)
    db.flush()
    track(db, "ai_draft_generated", principal.id, mode=data.mode, model_version=model_version, latency_bucket="<1m", safety_labels=labels)
    audit(db, actor_type="member", actor_id=principal.id, action="ai.draft_generated", resource_type="ai_draft", resource_id=draft.id, metadata={"mode": data.mode, "goal": data.goal, "model_version": model_version})
    return {"draft_id": draft.id, "text": text, "requires_member_review": True, "can_auto_send": False, "model_version": model_version, "safety_labels": labels, "provenance": "Drafted by the AI Wingman from your recent messages and the other member's own prompt answers. Edit freely; nothing is sent until you press send."}


@router.post("/{conv_id}/translations")
def create_translation(conv_id: str, data: TranslateIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    conv = get_conversation(db, conv_id, principal.id)
    _require_paid(db, principal.member, "translation")
    source_text = data.text
    if data.message_id:
        msg = db.get(Message, data.message_id)
        if msg is None or msg.conversation_id != conv.id:
            raise ApiError("NOT_FOUND")
        source_text = msg.body
    if not source_text:
        raise ApiError("VALIDATION_ERROR", "Provide text or a message to translate.")
    try:
        text, confidence, note, model_version = translate(source_text, data.source_lang, data.target_lang)
    except ValidationFailed as exc:
        raise ApiError("VALIDATION_ERROR", str(exc))
    except AIUnavailable:
        raise ApiError("AI_UNAVAILABLE", "Translation is unavailable right now. You can still send your message in its original language.", retryable=True)
    tr = Translation(conversation_id=conv.id, requester_id=principal.id, source_ref=data.message_id, source_lang=data.source_lang, target_lang=data.target_lang, source_text=source_text, translated_text=text, confidence=confidence, model_version=model_version)
    db.add(tr)
    db.flush()
    track(db, "translation_previewed", principal.id, language_pair=f"{data.source_lang}-{data.target_lang}", confidence_bucket="high" if confidence >= 0.7 else "low")
    return {"translation_id": tr.id, "source": {"lang": data.source_lang, "text": source_text}, "translated": {"lang": data.target_lang, "text": text}, "confidence": confidence, "low_confidence": confidence < 0.7, "note": note, "requires_member_review": True, "can_auto_send": False, "model_version": model_version, "created_at": iso(tr.created_at)}
