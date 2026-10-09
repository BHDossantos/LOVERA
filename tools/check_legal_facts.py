#!/usr/bin/env python3
"""The legal pages must not ship with a gap in them, and must not name a fact nobody declared.

These three documents — terms, privacy notice, community agreement — used to carry 21 inline
`<TODO>` markers. They rendered as highlighted yellow text, which to anybody who had not been told
otherwise looks like a deliberate design element rather than an unfinished document. Nothing failed
because of them, so nothing would have stopped a store submission with them in.

They are now one declaration each in `apps/web/src/app/legal/_facts.ts`, rendered through `<Fact>`.
This script checks the two things that can go wrong with that:

  1. **Drift.** A page naming a fact that does not exist renders a gap labelled with the fact's own
     name, which is the least useful possible error message. Always checked, in CI, on every push.

  2. **Gaps.** With `--require-all`, it fails while any required fact is unset. That is what
     docs/DEPLOY.md tells you to run before a production build or a store submission, and it is
     deliberately not the default: a developer running the suite locally has no business supplying a
     registered company address.

It reads `_facts.ts` as text rather than executing it, because running a TypeScript module from a
Python check would mean a toolchain this script does not otherwise need. The shape it matches is
narrow enough to break loudly if the file is restructured, which is the preferable failure.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEGAL = ROOT / "apps/web/src/app/legal"
FACTS_FILE = LEGAL / "_facts.ts"

# `name: { value: ..., describe: ... }` at one level of indentation inside FACTS.
DECLARATION = re.compile(r"^  (\w+): \{$", re.MULTILINE)
# Everything from a declaration to its closing brace, so `required` and `describe` can be read.
BLOCK = re.compile(r"^  (\w+): \{(.*?)^  \},$", re.MULTILINE | re.DOTALL)
USE = re.compile(r'<Fact\s+name="(\w+)"')
ENV_READ = re.compile(r'env\("([A-Z0-9_]+)"\)')


def declared() -> dict[str, dict[str, str]]:
    text = FACTS_FILE.read_text(encoding="utf-8")
    start = text.index("export const FACTS")
    body = text[start:]
    out: dict[str, dict[str, str]] = {}
    for name, block in BLOCK.findall(body):
        env = ENV_READ.search(block)
        out[name] = {
            "required": "false" if "required: false" in block else "true",
            "env": env.group(1) if env else "",
            # A fact with a non-env fallback is one this repository already answers.
            "derived": "true" if "??" in block else "false",
        }
    if not out:
        raise SystemExit(f"Could not read any fact declarations from {FACTS_FILE}. Has its shape changed?")
    return out


def used() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for page in sorted(LEGAL.rglob("*.tsx")):
        for name in USE.findall(page.read_text(encoding="utf-8")):
            out.setdefault(name, []).append(str(page.relative_to(ROOT)))
    return out


def main() -> int:
    require_all = "--require-all" in sys.argv
    facts, uses = declared(), used()
    failures: list[str] = []

    # 1. Drift, in both directions.
    for name, pages in sorted(uses.items()):
        if name not in facts:
            failures.append(f"{name} is rendered in {', '.join(pages)} but not declared in _facts.ts")
    unused = sorted(set(facts) - set(uses))
    for name in unused:
        failures.append(f"{name} is declared in _facts.ts but no page renders it")

    # 2. Gaps. Which are set can only be known from the environment this runs in, so the check is
    #    on the environment variable rather than on the rendered value.
    import os

    unset = [
        name
        for name, spec in sorted(facts.items())
        if spec["required"] == "true" and spec["derived"] == "false" and not os.environ.get(spec["env"], "").strip()
    ]

    print(f"checked {len(facts)} declared facts against {sum(len(p) for p in uses.values())} uses across {len({p for ps in uses.values() for p in ps})} pages")
    derived = sorted(n for n, s in facts.items() if s["derived"] == "true")
    if derived:
        print(f"{len(derived)} answered by this repository rather than asked for: {', '.join(derived)}")
    if unset:
        where = "MUST be set before a production build" if require_all else "still to be supplied by the operator"
        print(f"\n{len(unset)} fact(s) {where}:")
        for name in unset:
            print(f"  - {name}  ({facts[name]['env']})")
        if require_all:
            failures.extend(f"{name} is unset ({facts[name]['env']})" for name in unset)
    else:
        print("every required fact is set")

    if failures:
        print(f"\n{len(failures)} problem(s):", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        if require_all and unset:
            print(
                "\nThese are the documents a member and an app reviewer read. Set them in the "
                "deployment's environment (see apps/web/src/app/legal/_facts.ts for what each one "
                "is) and run this again.",
                file=sys.stderr,
            )
        return 1
    print("\nno drift, and nothing is rendered that nobody declared")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
