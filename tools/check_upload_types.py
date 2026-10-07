#!/usr/bin/env python3
"""Every file type the API accepts is offered by the picker, and nothing else is.

Both upload flows declare their accepted media types twice: once as the allow-list
`decode_data_url` enforces (`apps/api/app/core/datauri.py`), and once as the `accept` attribute on
the file input that chooses the file. The two have now disagreed in both directions:

  * the server was narrower than the picker — evidence accepted images and PDF while the picker
    offered video, audio and .txt, so a member chose a recording and was told it was not a file;
  * the picker was narrower than the server — the evidence list left out `audio/webm` and
    `audio/x-m4a`, which is what a browser recording and an iPhone voice memo are, so a reporter
    with the recording of the call could not attach it.

A comment on each constant asking the next person to keep them in step is what we had, and it is
what failed. This compares them.

Run: python tools/check_upload_types.py apps/web/src
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# The server's list is the source of truth, so it is imported rather than re-typed. The API is a
# sibling of this directory; adding it to the path means the check runs from anywhere, not only
# from inside apps/api as the first of these guards did.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "apps" / "api"))

from app.core.datauri import AUDIO_TYPES, DOCUMENT_TYPES, IMAGE_TYPES, VIDEO_TYPES  # noqa: E402

# The allow-list each client constant has to match, named by the `allowed` argument its endpoint
# passes to `decode_data_url`. A constant that is not in this table fails rather than passing
# unchecked: a new picker is a new place to drift.
EXPECTED: dict[str, tuple[str, ...]] = {
    # safety/service.py:add_evidence
    "EVIDENCE_ACCEPT": IMAGE_TYPES + VIDEO_TYPES + AUDIO_TYPES + DOCUMENT_TYPES,
    # profile/service.py:complete_media, which branches on the media's own type
    "PHOTO_ACCEPT": IMAGE_TYPES,
    "VOICE_ACCEPT": AUDIO_TYPES,
}

DECLARATION = re.compile(r"const\s+(\w*ACCEPT)\s*=\s*\[(.*?)\]\s*\.join\(", re.S)
QUOTED = re.compile(r"""["']([^"']+)["']""")


def main(roots: list[str]) -> int:
    found: dict[str, tuple[Path, set[str]]] = {}
    for root in roots:
        for path in sorted(Path(root).rglob("*.tsx")) + sorted(Path(root).rglob("*.ts")):
            text = path.read_text(encoding="utf-8")
            for name, body in DECLARATION.findall(text):
                if name in found:
                    print(f"FAIL {path}: {name} is declared twice; one of them will drift")
                    return 1
                found[name] = (path, set(QUOTED.findall(body)))

    problems = 0
    for name, (path, types) in sorted(found.items()):
        expected = EXPECTED.get(name)
        if expected is None:
            print(f"FAIL {path}: {name} is not in this check's table, so nothing compares it with the API")
            problems += 1
            continue
        missing = sorted(set(expected) - types)
        extra = sorted(types - set(expected))
        if missing:
            print(f"FAIL {path}: {name} omits {', '.join(missing)} — the API accepts them, so the picker hides a valid file")
            problems += 1
        if extra:
            print(f"FAIL {path}: {name} offers {', '.join(extra)} — the API refuses them, so the member is told no after choosing")
            problems += 1

    for name in sorted(set(EXPECTED) - set(found)):
        print(f"FAIL: {name} was not found in {', '.join(roots)}; this check cannot have been passing for the right reason")
        problems += 1

    if problems:
        return 1
    print(f"checked {len(found)} upload pickers against app/core/datauri.py; every one offers exactly what the API accepts")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["apps/web/src"]))
