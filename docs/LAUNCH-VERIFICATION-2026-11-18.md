# Launch verification — 18 November 2026

Base checked: `d02f3a6b06f0e8c8960581de317b6044bc545671`, matching remote main.
The SDK58 lock repairs (#59/#60) and billing fixes (#57) are already merged;
they are not outstanding merge blockers.

## Repair

The web conversation's memoized send callback captured an outdated selected
profile prompt. A message could therefore lose its quote. Pending messages also
discarded prompt and draft metadata, so retrying changed the original payload.
The composer now captures the prompt when a new message is sent, and the pending
message retains the full send payload. Retries preserve that payload and its
idempotency identifier. A browser regression test aborts the first send and
asserts that its retry carries the same payload, including `prompt_key`.

## Local evidence

- API: **262 tests passed** on a newly created, isolated PostgreSQL 16 container.
  Production data and credentials were not used.
- Web: clean dependency install, TypeScript, lint (zero warnings/errors), and
  production build passed. **Seven Playwright tests passed**, using installed
  Chromium, against the real local API and a separate local database. Coverage
  includes onboarding, private decisions, quote/retry, chat, reviewed AI draft,
  public date planning, safety check-in, and mutual-only second-date feedback.
- Mobile SDK58: clean dependency install, TypeScript, and **201 tests in 24
  suites passed**. Lint has zero errors and eight existing warnings.
- Contract check: 226 client API calls resolve against 113 routes. Safety target,
  query key, upload type and legal declaration consistency guards passed.

These flows use local sandbox identity, payment and mail paths. They do not
prove real email delivery, vendor verification or production purchasing.

## Remaining deployment evidence

No production deployment or database mutation was performed in this check.
Render workspace access confirmation is being handled by the owner. Historical
notes describe an expired Render database; neither its present recovery options
nor a deletion deadline were verified through account access in this check.
Do not recreate it or treat an empty replacement as recovery.

Before declaring a launch:

1. Inspect the existing database in the confirmed owner workspace; establish
   retained data/backups and the provider's supported restore or resume path.
   Obtain explicit authorization for any paid upgrade, then verify data after
   recovery before deploying against it.
2. Verify actual service configuration and the deployed commit. Check production
   mail delivery and sign-in, the selected staffed manual-review process or real
   identity adapter, and fail-closed billing configuration. Do not use development
   OTP exposure or sandbox verification to make production smoke tests pass.
3. Supply and review the actual legal operator facts. The repository check still
   lists 12 missing facts: entity, address, governing law, jurisdiction, consumer
   law, markets, privacy/support/safety emails, audit and safety retention, and
   transfer mechanism. Deployment values have not been inspected here.
4. Verify the recovered deployment's core flows with approved test accounts.
   A local build or a healthy HTTP page is insufficient. Native signing, store
   products, review accounts and store approval remain separately unverified.

The GitHub workflow connector returned no runs for the exact base commit; the
CLI Actions read was forbidden. This does not establish either green CI or a
current Actions billing failure. Public candidate Render probes were blocked
by this environment's network proxy and provide no service-health evidence.
