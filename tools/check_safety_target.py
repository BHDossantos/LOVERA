#!/usr/bin/env python3
"""No client may derive a safety action's subject from the neutralised profile.

`ConversationSummary.other` is deliberately emptied once a conversation closes — no name, no
photo, no id — and that took away the only thing Block and Report had to act on. So the API
carries the target separately, as `safety.subject_id`, and a client reading `other.member_id`
for it produces a subjectless report (reaching a reviewer who cannot act on anybody) and no way
to block, on precisely the threads where most reports get written.

This existed twice: once on mobile, found in review, and then again on the web after the mobile
half was fixed. Neither typecheck nor the contract check can see it — `other.member_id` is a real
field of a real type, it is just the wrong one — so it gets a check of its own.

    python tools/check_safety_target.py apps/mobile apps/web/src
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# A subject or a block target taken off the profile snapshot. The report URL spellings differ
# between the clients (template literal, query string builder), so this matches the data flow
# rather than any one form of it.
OFFENDERS = [
    re.compile(r"subject=\$\{[^}]*other[^}]*member_id"),
    re.compile(r'subject["\']?\s*[:=]\s*[^;\n]*other[^;\n]*member_id'),
    re.compile(r"member_id:\s*[^;\n]*other[^;\n]*member_id"),
    re.compile(r"disabled=\{!\s*(?:them|other)\??\.member_id"),
    # A named subject taken from any profile snapshot, whatever the variable holding it is called.
    # The mobile bug was `const subjectId = them?.member_id ?? null;`, where the profile had been
    # destructured first — so matching on `other` alone was not enough.
    re.compile(r"subject(?:Id|_id)[^=\n]*=[^;\n]*member_id"),
]

SKIP = {"node_modules", ".next", "dist", "build", "__pycache__", "android", "ios"}


def main(roots: list[str]) -> int:
    bad: list[str] = []
    checked = 0
    for root in roots:
        for path in Path(root).rglob("*.tsx"):
            if any(part in SKIP for part in path.parts):
                continue
            checked += 1
            text = path.read_text(encoding="utf-8")
            for lineno, line in enumerate(text.split("\n"), 1):
                # Once per line, not once per pattern: several of these describe the same mistake
                # and a line matching two of them is still one thing to fix.
                if any(rx.search(line) for rx in OFFENDERS):
                    bad.append(f"{path}:{lineno}: {line.strip()}")
    for b in bad:
        print(b)
    if bad:
        print()
        print(f"{len(bad)} place(s) take a safety action's subject from the profile snapshot.")
        print("Use `summary.safety.subject_id`: `other.member_id` is null on a closed conversation,")
        print("so a report filed from an ended thread names nobody and Block has nothing to act on.")
        return 1
    print(f"checked {checked} screens; every safety action takes its subject from `safety.subject_id`")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:] or ["apps/mobile", "apps/web/src"]
    raise SystemExit(main(args))
