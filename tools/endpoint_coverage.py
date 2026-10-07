"""Which member-facing endpoints each front end actually calls.

The readiness doc quotes this number, and counting it by hand gives a different answer every
time: calls go out through `get`/`post`/`patch`/`del`, through `api(path, { method })`, and in
one place through `fetch` directly, so any counter that knows about only the first kind
undercounts and reports endpoints as unreached that are reached.

It reuses the call-site reader from check_api_contract.py, which already resolves a literal
against the real schema including templated segments. This is a report, not a gate: an
endpoint a client has no business calling is not a defect, so there is nothing to fail on.

    python tools/endpoint_coverage.py openapi.json apps/web/src apps/mobile

Generate the schema from the API itself, so it cannot drift from the routes:
    python -c "import json; from app.main import app; json.dump(app.openapi(), open('openapi.json','w'))"
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import re
import sys

_spec = importlib.util.spec_from_file_location("cac", pathlib.Path(__file__).with_name("check_api_contract.py"))
assert _spec and _spec.loader
cac = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cac)

# `api("/notifications/devices", { method: "PUT" })` and `fetch(`${baseUrl()}/auth/refresh`, ...)`
# are the two shapes CALL_OPEN does not cover. Both name the path as a literal, so both are
# readable; the method comes from a `method:` nearby, defaulting to GET as the client does.
OTHER_CALL = re.compile(r"\b(?:api|fetch)\s*(?:<[^>]*>\s*)?\(\s*(?:`\$\{[A-Za-z0-9_().]*\}|([\"'`]))")
METHOD_NEAR = re.compile(r"method:\s*[\"']([A-Za-z]+)[\"']")


def member_routes(spec: dict) -> set[tuple[str, str]]:
    """Every endpoint a member's own app could legitimately call."""
    out = set()
    for path, ops in spec["paths"].items():
        if path == "/healthz" or "/webhooks/" in path or "/sandbox/" in path:
            continue
        for method, op in ops.items():
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            if "admin" in (op.get("tags") or []):
                continue
            out.add((method, path))
    return out


def calls(root: pathlib.Path, paths: dict[str, set[str]]) -> set[tuple[str, str]]:
    hit: set[tuple[str, str]] = set()
    for f in sorted({*root.rglob("*.ts"), *root.rglob("*.tsx")}):
        if "node_modules" in f.parts:
            continue
        text = f.read_text()
        for m in cac.CALL_OPEN.finditer(text):
            literal = cac.read_literal(text, m.end(), m.group(2))
            if literal is None or not literal[0].startswith("/"):
                continue
            route, _ = cac.resolve(cac.normalise(literal[0]), paths)
            if route:
                hit.add((cac.VERB[m.group(1)], route))
        for m in OTHER_CALL.finditer(text):
            quote = m.group(1)
            literal = cac.read_literal(text, m.end(), quote) if quote else _after_template(text, m.end())
            if literal is None or not literal[0].startswith("/"):
                continue
            route, _ = cac.resolve(cac.normalise(literal[0]), paths)
            if not route:
                continue
            near = METHOD_NEAR.search(text, m.end(), m.end() + 400)
            hit.add((near.group(1).lower() if near else "get", route))
    return hit


def _after_template(text: str, start: int) -> tuple[str, int] | None:
    """The literal tail of `` `${baseUrl()}/auth/refresh` ``, which is a path like any other."""
    end = text.find("`", start)
    return (text[start:end], end) if end > start else None


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    spec = json.loads(pathlib.Path(argv[1]).read_text())
    paths = {p: {m.lower() for m in ops} for p, ops in spec["paths"].items()}
    routes = member_routes(spec)
    for root in argv[2:]:
        hit = calls(pathlib.Path(root), paths) & routes
        print(f"{root}: {len(hit)} / {len(routes)} member endpoints")
        for method, path in sorted(routes - hit, key=lambda r: (r[1], r[0])):
            print(f"    not called  {method.upper():6} {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
