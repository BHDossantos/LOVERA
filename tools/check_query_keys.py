#!/usr/bin/env python3
"""Every cache key a mutation touches must be one some query actually uses.

React Query matches by key prefix and says nothing when nothing matches, so
`invalidateQueries({ queryKey: ["dates"] })` beside a list keyed `["date-plans"]` is a silent
no-op: the mutation looks like it refreshes the screen and does not. That shipped three times in
one file family — the web block path, the conversation close page, and the `date_plan.updated`
realtime handler all invalidated `["dates"]`, which no query has ever used, so a cancelled date
stayed on the Dates list looking scheduled and actionable.

Nothing else can see this. The key is a string literal in a call that always succeeds.

Each root is checked against its own queries, never against the union of both. Every app has its
own QueryClient, so a key the web app produces means nothing inside the mobile one: pooling them
would accept a mobile invalidation of `["plans"]` — a web-only key — which is exactly the silent
no-op this exists to catch, and the guard would have been asserting something weaker than it
claimed.

    python tools/check_query_keys.py apps/mobile apps/web/src
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# `useQuery({ queryKey: ["x", ...] })` and friends declare a key. Only the first segment matters:
# everything else is matched by prefix.
PRODUCER = re.compile(r"use(?:Query|InfiniteQuery|Queries)\(", re.S)
KEY = re.compile(r"""queryKey:\s*\[\s*["']([^"']+)["']""")

# The calls that act on a key. `setQueryData` and `getQueryData` take the array directly.
CONSUMER_OBJ = re.compile(r"""\.(invalidateQueries|removeQueries|resetQueries|cancelQueries|refetchQueries)\(\s*\{\s*queryKey:\s*\[\s*["']([^"']+)["']""")
CONSUMER_ARR = re.compile(r"""\.(setQueryData|getQueryData|getQueryState|setQueryDefaults)\(\s*\[\s*["']([^"']+)["']""")

SKIP_DIRS = {"node_modules", ".next", "dist", "build", "__pycache__", "android", "ios", "test", "tests", "e2e", "__tests__"}


def sources(root: str):
    for path in Path(root).rglob("*.tsx"):
        if not any(part in SKIP_DIRS for part in path.parts):
            yield path
    for path in Path(root).rglob("*.ts"):
        if not any(part in SKIP_DIRS for part in path.parts) and not path.name.endswith(".d.ts"):
            yield path


def scan(root: str) -> tuple[set[str], list[tuple[Path, int, str, str]]]:
    """The keys this client's queries produce, and every cache operation in it."""
    produced: set[str] = set()
    used: list[tuple[Path, int, str, str]] = []
    for path in sources(root):
        text = path.read_text(encoding="utf-8")
        # A producer's key can sit a line or two below the `useQuery(`, so the window is the
        # text following each call rather than the same line.
        for m in PRODUCER.finditer(text):
            window = text[m.end() : m.end() + 400]
            k = KEY.search(window)
            if k:
                produced.add(k.group(1))
        for lineno, line in enumerate(text.split("\n"), 1):
            for rx in (CONSUMER_OBJ, CONSUMER_ARR):
                for c in rx.finditer(line):
                    used.append((path, lineno, c.group(1), c.group(2)))
    return produced, used


def main(roots: list[str]) -> int:
    failed = False
    checked = 0
    for root in roots:
        produced, used = scan(root)
        checked += len(used)
        dead = [(p, n, call, key) for (p, n, call, key) in used if key not in produced]
        for p, n, call, key in dead:
            print(f'{p}:{n}: {call} on ["{key}"], which no query in {root} uses')
        if dead:
            failed = True
            print()
            print(f"{len(dead)} cache operation(s) in {root} name a key nothing in {root} reads.")
            print("React Query matches by prefix and reports no match, so each of these is a silent")
            print("no-op: the screen it was meant to refresh keeps showing what the server has changed.")
            print(f"Keys {root} queries actually use: {', '.join(sorted(produced))}")
            print()
        else:
            print(f"{root}: {len(used)} cache operations against {len(produced)} query keys; every one matches")
    if failed:
        return 1
    print(f"checked {checked} cache operations; every one names a key its own client produces")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:] or ["apps/mobile", "apps/web/src"]))
