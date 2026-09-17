"""In-process realtime hub with optional Redis fan-out. Tokens are short lived and participant scoped."""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

import jwt
from fastapi import WebSocket

from app.core.config import get_settings
from app.core.timeutil import utcnow

log = logging.getLogger("realtime")


class Hub:
    def __init__(self) -> None:
        self._sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._pending: list[tuple[str, dict[str, Any]]] = []

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, member_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._sockets[member_id].add(ws)
        self.bind_loop(asyncio.get_running_loop())

    def disconnect(self, member_id: str, ws: WebSocket) -> None:
        self._sockets[member_id].discard(ws)

    def push(self, member_id: str, event: dict[str, Any]) -> None:
        """Thread-safe publish from request handlers (sync SQLAlchemy code)."""
        sockets = list(self._sockets.get(member_id, ()))
        if not sockets:
            return
        payload = json.dumps(event, default=str)
        loop = self._loop
        if loop is None or loop.is_closed():
            return

        async def _send() -> None:
            for ws in sockets:
                try:
                    await ws.send_text(payload)
                except Exception:  # noqa: BLE001
                    self.disconnect(member_id, ws)

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            loop.create_task(_send())
        else:
            asyncio.run_coroutine_threadsafe(_send(), loop)


hub = Hub()


def issue_realtime_token(member_id: str) -> str:
    settings = get_settings()
    return jwt.encode({"sub": member_id, "typ": "realtime", "exp": int(utcnow().timestamp()) + 300}, settings.secret_key, algorithm="HS256")


def verify_realtime_token(token: str) -> str | None:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return payload.get("sub") if payload.get("typ") == "realtime" else None
