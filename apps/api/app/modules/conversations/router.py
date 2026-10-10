from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db, session_factory
from app.core.deps import Principal, current_principal
from app.core.errors import ApiError
from app.modules.conversations import service
from app.modules.conversations.realtime import hub, issue_realtime_token, verify_realtime_token

router = APIRouter(tags=["conversations"])


class MessageIn(BaseModel):
    client_message_id: str = Field(min_length=8, max_length=64)
    text: str = Field(min_length=1, max_length=4000)
    type: str = Field(default="text", pattern="^(text|voice)$")
    draft_id: str | None = None
    # The prompt of theirs this message answers. Validated server-side against what they really
    # wrote, because the quote renders as their words.
    prompt_key: str | None = None
    translation_id: str | None = None
    source_lang: str | None = None


class ReadIn(BaseModel):
    sequence: int


class CloseIn(BaseModel):
    reason: str = Field(default="not_for_me", pattern="^(not_for_me|timing|met_someone|no_reply|other|safety)$")
    private_note: str | None = Field(default=None, max_length=300)
    block: bool = False


class VoiceIn(BaseModel):
    duration_seconds: int = Field(ge=1, le=60)


@router.get("/conversations")
def list_conversations(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return {"items": service.list_for(db, principal.member), "pilot_cap": 3}


@router.get("/conversations/{conv_id}")
def get_conversation(conv_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    conv = service.get_conversation(db, conv_id, principal.id)
    return service.summary(db, conv, principal.member)


@router.get("/conversations/{conv_id}/messages")
def get_messages(conv_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function"), cursor: int | None = Query(default=None), limit: int = Query(default=50, le=100)) -> dict:
    conv = service.get_conversation(db, conv_id, principal.id)
    return service.history(db, conv, principal.id, cursor, limit)


@router.post("/conversations/{conv_id}/messages", status_code=201)
def send(conv_id: str, data: MessageIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    meta: dict[str, Any] = {}
    if data.draft_id:
        meta["draft_id"] = data.draft_id
        meta["draft_assisted"] = True
        from app.models.ai import AIDraft

        draft = db.get(AIDraft, data.draft_id)
        if draft and draft.requester_id == principal.id:
            import hashlib

            draft.status = "used"
            draft.accepted_text_hash = hashlib.sha256(data.text.encode()).hexdigest()
            meta["edit_bucket"] = "none" if draft.draft_text.strip() == data.text.strip() else "edited"
    if data.prompt_key:
        meta["prompt_key"] = data.prompt_key
    if data.translation_id:
        meta["translation_id"] = data.translation_id
        meta["translated_from"] = data.source_lang
    if data.source_lang:
        meta["source_lang"] = data.source_lang
    msg = service.send_message(db, conv_id, principal.member, data.client_message_id, data.text, data.type, meta)
    return service.message_payload(msg, principal.id)


@router.get("/conversations/{conv_id}/openers")
def openers(conv_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    """Things to actually say, for a conversation nobody has spoken in yet.

    A blank box after a mutual yes is where most conversations die. These are the other person's
    own prompt answers — written to be responded to, chosen by them — so a first message can be a
    specific reply rather than "hey".
    """
    conv = service.get_conversation(db, conv_id, principal.id)
    return {"items": service.openers_for(db, conv, principal.member)}


@router.post("/conversations/{conv_id}/read", status_code=204)
def read(conv_id: str, data: ReadIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> None:
    conv = service.get_conversation(db, conv_id, principal.id)
    service.mark_read(db, conv, principal.id, data.sequence)


@router.post("/conversations/{conv_id}/close")
def close(conv_id: str, data: CloseIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    return service.close(db, conv_id, principal.member, data.reason, data.private_note, data.block)


@router.post("/conversations/{conv_id}/voice-sessions")
def voice_session(conv_id: str, data: VoiceIn, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.get_conversation(db, conv_id, principal.id)
    return {"upload": {"method": "POST", "url": f"/v1/conversations/{conv_id}/messages", "note": "Pilot: voice notes are transcribed client-side and sent as type=voice text; audio upload arrives with the media service."}, "max_seconds": 60}


@router.post("/conversations/{conv_id}/video-tokens")
def video_token(conv_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    service.get_conversation(db, conv_id, principal.id)
    return {"status": "not_available_in_pilot", "message": "Short video calls arrive after the pilot. Voice notes and a public first date are available now.", "guidance": ["No beauty filters by default.", "Declining a call is never treated as suspicious.", "Recording without consent violates the community agreement."]}


@router.get("/realtime/token")
def realtime_token(principal: Principal = Depends(current_principal)) -> dict:
    return {"token": issue_realtime_token(principal.id), "expires_in": 300, "url": "/v1/realtime/ws"}


@router.websocket("/realtime/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query(default="")) -> None:
    member_id = verify_realtime_token(token)
    if not member_id:
        await ws.close(code=4401)
        return
    await hub.connect(member_id, ws)
    try:
        while True:
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        hub.disconnect(member_id, ws)
