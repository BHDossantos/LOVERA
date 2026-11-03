# Historical billing operations (draft; not deployed)

New direct `app_store`/`play_store` purchases remain disabled. RevenueCat is the supported purchase path. These tools add recovery/reconciliation capability; they do not prove live store readiness.

## No-network dry runs

From `apps/api`, with an explicitly selected local/test database:

```
python -m app.modules.billing.operations poll
python -m app.modules.billing.operations migrate --member-id <internal-member-id>
```

Default mode makes no provider calls and no database writes. Reports contain counts/status and internal references, not receipts, keys, emails or provider response bodies. Poll inventory exposes missing tracking schema, due jobs and oldest due time.

## Historical direct App Store lifecycle

The new `store_reconciliations` table tracks next-check time, attempts and bounded outcome codes. Normal application schema initialization creates it during an approved release; the CLI never creates schema implicitly. After sandbox acceptance, an approved runner can invoke:

```
python -m app.modules.billing.operations poll --apply --limit 100
```

Schedule it hourly and drain additional batches until both `due_remaining` and `untracked_receipts` are zero. Monitor `oldest_due_at` and retry/backlog counts; capacity must cover all existing receipts. Concurrent workers use database row locks and conflict-safe job seeding. No scheduler was created or configured in this work.

Polling uses the existing authenticated App Store transaction verifier for known historical receipts. A refund/expiry revokes only its linked direct grant; an outage retains no access beyond the last verified expiry and records a retry (5 minutes increasing to 60). A migrated RevenueCat receipt is not modified. No charge, cancel, purchase acknowledgment or raw-receipt import is sent. A missing expiry or mismatched transaction is retryable, never a fabricated subscription term.

Required provider configuration: `MM_APP_STORE_ISSUER_ID`, `MM_APP_STORE_KEY_ID`, `MM_APP_STORE_PRIVATE_KEY`, correct `MM_APP_STORE_BUNDLE_ID` and environment. Real sandbox refund, expiry, outage, reversal and overlapping-subscription acceptance remains required. Polling known transaction IDs does not discover every new renewal transaction. This is not a reason to enable new direct purchases; autonomous ingestion of new store transactions and a monitored runner are still release gates.

## Historical RevenueCat migration

`migrate --member-id ... --apply` reconciles an existing RevenueCat customer through server-to-server reads and atomically retires only matching direct transaction grants. It reports `remaining_direct_grants` and `migration_complete`; an unmatched historical grant is not silently removed or called migrated.

This tool does not import transaction/order IDs as if they were receipts. RevenueCat's [historical migration documentation](https://www.revenuecat.com/docs/migrating-to-revenuecat/migrating-existing-subscriptions) requires actual Apple receipts or Google purchase tokens for server-side imports. This database stores transaction references, not a verified complete raw-receipt archive. Missing historical receipts therefore require an approved client restore/import path or an authoritative receipt archive. Provider project/store setup and account-transfer policy must be resolved before applying migration.

No command with `--apply` was run against a live service or production database. Tests use local PostgreSQL and mocked providers. Credentials, store settings, scheduler deployment and sandbox proof remain owner-controlled gates.

Validation: 226 full API tests passed; 4 final worker tests passed, including no-write/no-network preview, refund without mobile restore, durable outage retry, migrated-receipt isolation and concurrent polling. CLI dry run was exercised only against an isolated test database and reported `provider_calls: 0`, `writes: 0`.
