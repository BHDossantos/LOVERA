"""Sortable, opaque identifiers. Never expose sequential IDs."""
from __future__ import annotations

import os
import time
import uuid


def uuid7() -> uuid.UUID:
    """UUIDv7-style time ordered UUID (48 bit ms timestamp + random)."""
    ts = int(time.time() * 1000) & ((1 << 48) - 1)
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ts << 80) | (0x7 << 76) | ((rand >> 2) & ((1 << 76) - 1))
    # set variant bits (10xx)
    value &= ~(0x3 << 62)
    value |= 0x2 << 62
    return uuid.UUID(int=value)


def new_id() -> str:
    return str(uuid7())
