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
what failed. This compares them, and it has to do that per *call site branch* rather than per name:
one endpoint serves two kinds of media from one conditional, so a check that only asked whether
each named list appears somewhere in the API would pass with the two branches swapped, while both
pickers offered files their own branch rejects.

So the allow-list each picker is compared against is read out of the code in three steps:

  1. find the `decode_data_url` calls in the API and read the `allowed` argument with `ast`. A bare
     name, or a conditional on a media kind, is readable; anything assembled at the call site is
     refused rather than guessed at, because a guess is what this check exists to replace;
  2. key each one by the module it is in and the media kind its branch tests for, so a swap between
     two branches of the same call changes what this check compares;
  3. compare each client `*_ACCEPT` constant with the types of the list at the key it declares.

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

# Marks the fall-through branch of a conditional allow-list, and the single allow-list of a call
# that has no conditional. Not a media kind, so it cannot collide with one.
OTHERWISE = None

# Which call site, and which branch of it, each client picker has to match. The media types are
# *not* written here — they come from the module, and the name of the list comes from the code at
# the key below. A picker missing from this table fails rather than passing unchecked, and so does a
# key with no call site, so a new picker or a moved endpoint is a loud failure.
EXPECTED: dict[str, tuple[str, str | None]] = {
    "EVIDENCE_ACCEPT": ("app/modules/safety/service.py", OTHERWISE),
    "VOICE_ACCEPT": ("app/modules/profile/service.py", "voice"),
    "PHOTO_ACCEPT": ("app/modules/profile/service.py", OTHERWISE),
}

DECLARATION = re.compile(r"const\s+(\w*ACCEPT)\s*=\s*\[(.*?)\]\s*\.join\(", re.S)
QUOTED = re.compile(r"""["']([^"']+)["']""")

Key = tuple[str, str | None]


def branch_kind(test: ast.expr) -> str | None:
    """The media kind a conditional allow-list's test selects, e.g. `media.type == "voice"`.

    Only a single `==` against a string literal counts. Anything else is unreadable, because the
    association between a branch and the picker that feeds it is exactly what this check is for.
    """
    if isinstance(test, ast.Compare) and len(test.ops) == 1 and isinstance(test.ops[0], ast.Eq):
        right = test.comparators[0]
        if isinstance(right, ast.Constant) and isinstance(right.value, str):
            return right.value
    return None


def allow_lists(node: ast.expr) -> dict[str, str] | None:
    """`{media kind or OTHERWISE: list name}` for an `allowed` argument, or None if unreadable."""
    if isinstance(node, ast.Name):
        return {"": node.id}  # keyed below; "" stands in for OTHERWISE inside this dict
    if isinstance(node, ast.IfExp):
        kind = branch_kind(node.test)
        chosen, fallback = allow_lists(node.body), allow_lists(node.orelse)
        if kind is None or chosen is None or fallback is None:
            return None
        # Only the simple shape `A if x == "kind" else B` is read; a nested conditional would need
        # its own key scheme and there is no such call site.
        if list(chosen) != [""] or list(fallback) != [""]:
            return None
        return {kind: chosen[""], "": fallback[""]}
    return None


def server_lists() -> tuple[dict[Key, str], int, int]:
    """Every allow-list the API enforces, keyed by the call site branch that enforces it."""
    found: dict[Key, str] = {}
    calls = 0
    problems = 0
    for path in sorted((REPO / "apps" / "api" / "app").rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "decode_data_url"):
                continue
            calls += 1
            rel = path.relative_to(REPO / "apps" / "api").as_posix()
            arg = node.args[2] if len(node.args) > 2 else next((k.value for k in node.keywords if k.arg == "allowed"), None)
            lists = allow_lists(arg) if arg is not None else None
            if lists is None:
                print(f"FAIL {rel}:{node.lineno}: the allow-list passed here is not a named list from app/core/datauri.py, or is chosen by something this check cannot read, so no picker can be compared against it")
                problems += 1
                continue
            for kind, name in lists.items():
                key: Key = (rel, kind or OTHERWISE)
                if key in found and found[key] != name:
                    print(f"FAIL {rel}:{node.lineno}: two allow-lists claim {key!r} ({found[key]} and {name}); this check cannot tell which a picker means")
                    problems += 1
                found[key] = name
    return found, calls, problems


def main(roots: list[str]) -> int:
    enforced, calls, problems = server_lists()

    if not calls:
        print("FAIL: no decode_data_url calls found in apps/api/app; this check cannot have been passing for the right reason")
        return 1

    for key in sorted(set(enforced) - set(EXPECTED.values()), key=lambda k: (k[0], k[1] or "")):
        print(f"FAIL: {key[0]} enforces {enforced[key]} for {key[1] or 'everything else'}, which no picker in this check's table declares — add it, with the client constant that offers it")
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
        key = EXPECTED.get(name)
        if key is None:
            print(f"FAIL {path}: {name} is not in this check's table, so nothing compares it with the API")
            problems += 1
            continue
        list_name = enforced.get(key)
        if list_name is None:
            print(f"FAIL {path}: {name} is checked against {key[0]} for {key[1] or 'everything else'}, and no decode_data_url call there enforces anything for that any more")
            problems += 1
            continue
        expected = set(getattr(datauri, list_name))
        missing = sorted(expected - types)
        extra = sorted(types - expected)
        if missing:
            print(f"FAIL {path}: {name} omits {', '.join(missing)} — {list_name}, enforced by {key[0]} for {key[1] or 'everything else'}, accepts them, so the picker hides a valid file")
            problems += 1
        if extra:
            print(f"FAIL {path}: {name} offers {', '.join(extra)} — {list_name}, enforced by {key[0]} for {key[1] or 'everything else'}, refuses them, so the member is told no after choosing")
            problems += 1

    for name in sorted(set(EXPECTED) - set(found)):
        print(f"FAIL: {name} was not found in {', '.join(roots)}; this check cannot have been passing for the right reason")
        problems += 1

    if problems:
        return 1
    print(f"checked {len(found)} upload pickers against the {len(enforced)} allow-lists {calls} decode_data_url calls enforce, branch by branch; every one offers exactly what its own branch accepts")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["apps/web/src"]))
