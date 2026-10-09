#!/usr/bin/env python3
"""Check that every API call in the client apps hits an endpoint that exists.

The two front ends address the API with string literals. Nothing connects those strings
to the FastAPI routes they are meant to hit, so a path that was renamed, pluralised, or
never existed compiles, typechecks, bundles, and ships — and fails at runtime, on a real
member's phone, in the one screen nobody opened during review.

That is not hypothetical. It is how the mobile Safety tab came to call `/safety/center`
when the endpoint is `/safety`, and how "Confirm this date" came to POST to a
`/confirm` route that has never existed in this codebase.

Usage:
    python tools/check_api_contract.py openapi.json apps/mobile apps/web/src

Generate the schema from the API itself, so it cannot drift from the routes:
    python -c "import json; from app.main import app; json.dump(app.openapi(), open('openapi.json','w'))"
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

# The opening of a call to one of the five helpers in both api clients:
# `get("/x")`, `post<T>(`/x/${id}`)`, `del(...)`. The literal itself is scanned rather
# than matched, because a template literal can contain another one —
# `` `/date-plans/${id}/venues${style ? `?style=${style}` : ""}` `` — and a regex that
# stops at the first backtick truncates the path and then reports it as missing.
# A type argument can itself contain angle brackets — `get<Record<string, unknown>>(...)` —
# and a pattern that stops at the first `>` matches nothing here, so the call was skipped
# silently. One level of nesting covers everything in these two apps; a deeper one would be
# skipped again rather than mis-read, so tools/endpoint_coverage.py is where that would show.
CALL_OPEN = re.compile(
    r'\b(get|post|put|patch|del)\s*(?:<(?:[^<>()]|<[^<>()]*>)*>)?\s*\(\s*([`"\'])'
)
VERB = {"get": "get", "post": "post", "put": "put", "patch": "patch", "del": "delete"}
PREFIX = "/v1"
# A `?` that opens a string literal, which is how a conditional query suffix is written.
QUERY_SUFFIX = re.compile(r"""[`"']\?""")


def strip_interpolations(path: str) -> str:
    """Reduce a template literal to the path it addresses.

    An interpolation standing in for a path segment becomes one segment. An
    interpolation that builds a conditional query suffix —
    `${style ? `?style=${style}` : ""}` — is not part of the path at all, so everything
    from there on is dropped.

    What marks the second kind is a `?` that opens a *string*, not just a `?` anywhere in the
    expression: `${plan?.id}` is optional chaining standing in for one segment, and reading its
    `?` as a query suffix truncated `/date-plans/${plan?.id}/overlaps` to `/date-plans`, which
    is also a real route — so the call passed the check without ever being checked. Still a
    heuristic, but the alternative is evaluating TypeScript.
    """
    out, i = [], 0
    while i < len(path):
        if path.startswith("${", i):
            depth, j = 1, i + 2
            while j < len(path) and depth:
                if path[j] == "{":
                    depth += 1
                elif path[j] == "}":
                    depth -= 1
                j += 1
            if QUERY_SUFFIX.search(path[i:j]):
                break  # a query suffix, and the path ended before it
            out.append("X")
            i = j
        else:
            out.append(path[i])
            i += 1
    return "".join(out)


def read_literal(text: str, start: int, quote: str) -> tuple[str, int] | None:
    """Read the string literal beginning at `start`, which is just past its opening quote.

    For a template literal, a backtick only closes it at `${}` depth zero; inside an
    interpolation a backtick opens a nested literal that must not end the outer one.
    """
    out, i, depth = [], start, 0
    while i < len(text):
        c = text[i]
        if c == "\\":
            out.append(text[i : i + 2])
            i += 2
            continue
        if quote == "`" and text.startswith("${", i):
            depth += 1
            out.append("${")
            i += 2
            continue
        if depth:
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            out.append(c)
            i += 1
            continue
        if c == quote:
            return "".join(out), i
        if c == "\n" and quote != "`":
            return None
        out.append(c)
        i += 1
    return None


def normalise(raw: str) -> str:
    return PREFIX + strip_interpolations(raw).split("?")[0].split("#")[0].rstrip("/")


def resolve(call: str, paths: dict[str, set[str]]) -> tuple[str | None, set[str]]:
    """Find the route a call lands on, preferring an exact match over a templated one.

    `/preferences/impact-preview` is a real route *and* matches `/preferences/{key}`.
    Checking the literal first is the difference between a useful signal and a nuisance.
    """
    if call in paths:
        return call, paths[call]
    for route, methods in paths.items():
        if "{" not in route:
            continue
        if re.fullmatch(re.sub(r"\\\{[^}]*\\\}", "[^/]+", re.escape(route)), call):
            return route, methods
    return None, set()


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    spec = json.loads(pathlib.Path(argv[1]).read_text())
    paths = {p: {m.lower() for m in ops} for p, ops in spec["paths"].items()}

    findings, checked = [], 0
    for root in argv[2:]:
        base = pathlib.Path(root)
        for f in sorted({*base.rglob("*.ts"), *base.rglob("*.tsx")}):
            if "node_modules" in f.parts:
                continue
            text = f.read_text()
            for m in CALL_OPEN.finditer(text):
                literal = read_literal(text, m.end(), m.group(2))
                if literal is None:
                    continue
                raw = literal[0]
                if not raw.startswith("/"):
                    continue  # a relative or computed path; nothing to check here
                checked += 1
                verb = VERB[m.group(1)]
                route, methods = resolve(normalise(raw), paths)
                where = f"{f}:{text[: m.start()].count(chr(10)) + 1}"
                if route is None:
                    findings.append((where, verb, raw, "no endpoint matches this path"))
                elif verb not in methods:
                    findings.append(
                        (where, verb, raw, f"{route} exists but allows only {sorted(methods)}")
                    )

    print(f"checked {checked} API calls against {len(paths)} routes")
    for where, verb, raw, why in findings:
        print(f"\n  {verb.upper():6} {raw}")
        print(f"         {where}")
        print(f"         {why}")
    if findings:
        print(f"\n{len(findings)} call(s) cannot succeed at runtime")
        return 1
    print("every call resolves to a route that accepts it")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
