"""Local operator interface; default is a no-network, no-write dry run.

Examples:
  python -m app.modules.billing.operations poll
  python -m app.modules.billing.operations migrate --member-id <internal-id>

--apply requires an approved target environment and configured provider keys.
Schedule `poll --apply` hourly only after sandbox acceptance and deployment review.
It reconciles historical direct receipts; it does NOT enable new direct purchases.
"""
import argparse
import json
from app.core.db import session_factory
from app.modules.billing.reconciliation import poll, migrate_member


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('poll', 'migrate'))
    parser.add_argument('--member-id')
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.operation == 'migrate' and not args.member_id:
        parser.error('migrate requires --member-id')
    with session_factory()() as db:
        result = poll(db, apply=args.apply, limit=args.limit) if args.operation == 'poll' else migrate_member(db, args.member_id, apply=args.apply)
        if args.apply:
            db.commit()
        else:
            db.rollback()
        print(json.dumps(result))

if __name__ == '__main__':
    main()
