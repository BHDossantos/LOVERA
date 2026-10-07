"""Validation for the data URLs members upload.

Both upload paths — profile media and safety evidence — took `data_url` as a string and stored it
unread, next to a `content_type` the member also supplied. Nothing checked that the two agreed, or
that the string was a data URL at all.

So an authenticated member could skip the file picker and send
`{"content_type": "image/png", "data_url": "https://attacker.example/beacon.png"}`. The stored
"attachment" is then handed to whoever opens it as an image source: on a safety case, that is the
reviewer handling a report about the person who uploaded it. Their browser fetches the URL, and the
reporter learns their address, their user agent and the moment they opened the case — from inside
the one workflow that exists to protect people from them. The same string on profile media reaches
another member the same way.

Nothing about that needs a remote fetch to be useful, so the fix is to refuse anything that is not
an inline data URL of a type we expected, carrying bytes that start the way that type starts.
"""
from __future__ import annotations

import base64
import binascii
import re

from app.core.errors import ApiError

IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp", "image/gif")
AUDIO_TYPES = ("audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-m4a")
DOCUMENT_TYPES = ("application/pdf",)

# What a file of each type begins with. An allow-listed media type is not enough on its own: a
# document whose bytes are HTML, served to a reviewer as `image/png`, is a different kind of
# problem, and the first few bytes settle it for every format we accept here. Audio containers vary
# too much for this to be worth guessing, and they are not rendered as markup anywhere, so they are
# checked by type alone.
SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "application/pdf": (b"%PDF-",),
}

HEADER = re.compile(r"^data:([a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*)((?:;[^,;]*)*);base64,(.*)$", re.S)


def decode_data_url(data_url: str, declared_content_type: str, allowed: tuple[str, ...], field: str = "data_url") -> bytes:
    """The bytes a data URL carries, or a validation error naming what is wrong with it.

    `allowed` is the caller's list, because the answer differs: a profile photo is an image or a
    voice note, a piece of safety evidence is an image or a PDF. Neither is ever a URL somebody
    else's browser has to go and fetch.
    """

    def refuse(message: str) -> ApiError:
        return ApiError("VALIDATION_ERROR", message, field_errors={field: "invalid"})

    match = HEADER.match(data_url.strip())
    if not match:
        raise refuse("Attachments have to be sent as the file itself, base64 in a data URL. A link to somewhere else is not accepted.")
    media_type = match.group(1).lower()
    payload = match.group(3)

    declared = (declared_content_type or "").split(";")[0].strip().lower()
    if declared and declared != media_type:
        raise refuse(f"The file says it is {media_type} and the upload says {declared}. They have to match.")
    if media_type not in allowed:
        raise refuse(f"{media_type} is not a file type we can accept here.")

    try:
        # `validate=True`, so a payload with characters outside the base64 alphabet is refused
        # rather than quietly skipped — which is how something that is not base64 at all could
        # otherwise decode to a few plausible bytes.
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise refuse("That attachment is not valid base64. Send the file again.")
    if not raw:
        raise refuse("That attachment is empty.")

    expected = SIGNATURES.get(media_type)
    if expected and not raw.startswith(expected):
        raise refuse(f"That file does not look like {media_type} inside. Send the original file rather than a renamed one.")
    if media_type == "image/webp" and not (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"):
        raise refuse("That file does not look like image/webp inside. Send the original file rather than a renamed one.")
    return raw
