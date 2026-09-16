"""python -m app.jobs [tick|match <market>]"""
from __future__ import annotations

import json
import sys

from app.core.db import session_factory
from app.jobs import register_handlers, run_all
from app.main import create_schema


def main() -> None:
    create_schema()
    register_handlers()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "tick"
    db = session_factory()()
    try:
        if cmd == "match":
            from app.modules.matching.service import run_batch, run_payload

            run = run_batch(db, sys.argv[2] if len(sys.argv) > 2 else "rome", auto_publish="--publish" in sys.argv)
            db.commit()
            print(json.dumps(run_payload(run), indent=2))
        else:
            out = run_all(db)
            db.commit()
            print(json.dumps(out, indent=2))
    finally:
        db.close()


if __name__ == "__main__":
    main()
