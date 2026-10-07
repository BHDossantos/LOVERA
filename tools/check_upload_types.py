#!/usr/bin/env python3
"""Every file type an upload endpoint accepts is offered by its picker, and nothing else is.

Both upload flows declare their accepted media types twice: once as the allow-list
`decode_data_url` enforces, and once as the `accept` attribute on the input that chooses the file.
The two have now disagreed in both directions:

  * the server was narrower than the picker — evidence accepted images and PDF while the picker
    offered video, audio and .txt, so a member chose a recording and was told it was not a file;
  * the picker was narrower than the server — the evidence list left out `audio/webm` and
    `audio/x-m4a`, which is what a browser recording and an iPhone voice memo are, so a reporter
    with the recording of the call could not attach it.

A comment on each constant asking the next person to keep them in step is what we had, and it is
what failed. This compares them, in two steps so that neither side can move alone:

  1. every `decode_data_url` call in the API passes one of the named endpoint allow-lists from
     `app/core/datauri.py` — not an expression assembled at the call site, which this check could
     not read and which could therefore be narrowed without it noticing;
  2. each client `*_ACCEPT` constant holds exactly the types of the list its endpoint passes.

Run: python tools/check_upload_types.py apps/web/src
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
# The server's lists are the source of truth, so they are imported rather than re-typed. The API is
# a sibling of this directory; adding it to the path means the check runs from anywhere, not only
# from inside apps/api as the first of these guards did.
sys.path.insert(0, str(REPO / "apps" / "api"))

from app.core import datauri  # noqa: E402

# Which named allow-list each client picker has to match. The types themselves are *not* written
# here — only the name of the list, which is read from `datauri` and checked against the call that
# enforces it. A constant missing from this table fails rather than passing unchecked: a new picker,
# or a new endpoint, is a new place to drift.
EXPECTED: dict[str, str] = {
    "EVIDENCE_ACCEPT": "EVIDENCE_TYPES",  # safety/service.py:add_evidence
    "PHOTO_ACCEPT": "PHOTO_TYPES",  # profile/service.py:complete_media, on a photo
    "VOICE_ACCEPT": "VOICE_TYPES",  # profile/service.py:complete_media, on a voice note
}

DECLARATION = re.compile(r"const\s+(\w*ACCEPT)\s*=\s*\[(.*?)\]\s*\.join\(", re.S)
QUOTED = re.compile(r"""["']([^"']+)["']""")


def allow_list_names(node: ast.expr) -> list[str] | None:
    """The endpoint lists an `allowed` argument resolves to, or None if it is not readable here.

    A bare name is the ordinary case; a conditional is how one endpoint serves two kinds of media.
    Anything else — a concatenation, a call, a variable assembled earlier — is refused rather than
    guessed at, because a guess is what this check exists to replace.
    """
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, ast.IfExp):
        a, b = allow_list_names(node.body), allow_list_names(node.orelse)
        return None if a is None or b is None else a + b
    return None


def server_lists() -> tuple[set[str], int]:
    """Every allow-list the API actually enforces, read from the calls that enforce it."""
    names: set[str] = set()
    calls = 0
    for path in sorted((REPO / "apps" / "api" / "app").rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "decode_data_url"):
                continue
            calls += 1
            arg = node.args[2] if len(node.args) > 2 else next((k.value for k in node.keywords if k.arg == "allowed"), None)
            found = allow_list_names(arg) if arg is not None else None
            if found is None:
                rel = path.relative_to(REPO)
                print(f"FAIL {rel}:{node.lineno}: the allow-list passed here is not a named list from app/core/datauri.py, so no picker can be compared against it")
                names.add("!unreadable")
            else:
                names.update(found)
    return names, calls


def main(roots: list[str]) -> int:
    enforced, calls = server_lists()
    problems = 1 if "!unreadable" in enforced else 0
    enforced.discard("!unreadable")

    if not calls:
        print("FAIL: no decode_data_url calls found in apps/api/app; this check cannot have been passing for the right reason")
        return 1

    for name in sorted(enforced - set(EXPECTED.values())):
        print(f"FAIL: an endpoint enforces {name}, which no picker in this check's table declares — add it, with the client constant that offers it")
        problems += 1

    found: dict[str, tuple[Path, set[str]]] = {}
    for root in roots:
        for path in sorted(Path(root).rglob("*.tsx")) + sorted(Path(root).rglob("*.ts")):
            for name, body in DECLARATION.findall(path.read_text(encoding="utf-8")):
                if name in found:
                    print(f"FAIL {path}: {name} is declared twice; one of them will drift")
                    return 1
                found[name] = (path, set(QUOTED.findall(body)))

    for name, (path, types) in sorted(found.items()):
        list_name = EXPECTED.get(name)
        if list_name is None:
            print(f"FAIL {path}: {name} is not in this check's table, so nothing compares it with the API")
            problems += 1
            continue
        if list_name not in enforced:
            print(f"FAIL {path}: {name} is checked against {list_name}, which no endpoint passes to decode_data_url any more")
            problems += 1
            continue
        expected = set(getattr(datauri, list_name))
        missing = sorted(expected - types)
        extra = sorted(types - expected)
        if missing:
            print(f"FAIL {path}: {name} omits {', '.join(missing)} — {list_name} accepts them, so the picker hides a valid file")
            problems += 1
        if extra:
            print(f"FAIL {path}: {name} offers {', '.join(extra)} — {list_name} refuses them, so the member is told no after choosing")
            problems += 1

    for name in sorted(set(EXPECTED) - set(found)):
        print(f"FAIL: {name} was not found in {', '.join(roots)}; this check cannot have been passing for the right reason")
        problems += 1

    if problems:
        return 1
    print(f"checked {len(found)} upload pickers against the {len(enforced)} allow-lists {calls} decode_data_url calls enforce; every one offers exactly what its endpoint accepts")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["apps/web/src"]))
