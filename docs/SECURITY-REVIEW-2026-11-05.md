# Local security remediation — 2026-11-05

Based on draft #52 head `4d8310776a226ac11b19de94c161be8aba9739d7`, which contains current main `36f685806a55422870ff64d1804ba83c94aad5dc`. Preserves #52 billing work; does not merge separate mobile release-validation draft #48 (`3a802cd655732801d20529ab1f701a6a091fc5e6`). No push, merge, deployment, payment, provider request, or configuration change was performed.

## Fixed locally

- Production startup now rejects committed/default or shorter-than-32-character JWT and both webhook signing secrets. Both webhook endpoints remain mounted even when their provider is inactive, so both secrets require protection. Errors name configuration keys without printing values.
- Explicit console delivery can no longer bypass production's sign-in mail gate. Development/staging console behavior remains unchanged.
- Environment values are enumerated, including `test`; spelling `production` incorrectly cannot silently disable production checks.
- Mobile lockfile updates node-forge 1.4.0 to compatible 1.4.3, removing its high-severity advisory entry. No Expo SDK upgrade or unrelated optional-peer pruning is included.

These startup checks intentionally prevent an unsafe production instance from booting. Before deployment, an authorized operator must verify private signing keys and SMTP are configured. No credentials were generated or rotated.

## Dependency evidence and remaining work

Fresh npm audits on the committed lockfiles: web 6 moderate entries, all arising from minimatch; mobile initially 25 entries (6 high, 10 moderate, 9 low), now 24 (5 high, 10 moderate, 9 low). Counts include affected ancestor packages, not distinct exploits. The web/runtime Next16.4.2 stack does not reproduce older critical Next findings.

Mobile remaining roots: decode-uri-component <=0.5.0, zod3, glob9–14.0.1/minimatch7–11.0.0, uuid<11.1.1, and deepmerge4.3.1. Expo/router/tooling changes need compatibility and native verification; do not accept npm's suggested downgrade to Expo53/Jest25. Web minimatch requires a tooling major transition or a reviewed override. No forced upgrades applied. Open dependency PR #53 proposes web upgrades and #51 proposes Expo58/zod changes; neither was applied or modified. Actual device/deep-link/receipt tests remain necessary for SDK changes.

## Validation and limits

24 focused API startup/configuration tests pass. A broader selection passed 24 tests but four database-backed identity tests could not initialize: local PostgreSQL socket `/tmp/.s.PGSQL.5433` is absent. No live database was used. Python environment installs current unpinned dependencies; this does not establish deployment reproducibility.

Mobile TypeScript and 191 tests across 23 suites pass after the node-forge update. Lint fails because the repository has no ESLint config and Expo's automatic configuration download is blocked by the network proxy; lint is not claimed passed. No web implementation changed, so web build was not rerun. No signed native binary, installed-device test, purchase, webhook delivery, or release was verified.

## Release gates

Parent's read-only Render inventory reports lovera-db expiration at 2026-11-06T20:35:26Z; authorized database retention/upgrade decision is urgent and remains outstanding. No provider configuration was changed here.

Draft #48 records an EAS main-push workflow capable of production OTA/native submission, separate from GitHub's manual mobile workflow. Owner review of that release path remains mandatory before any merge. #52 receipt reconciliation requires review, test configuration, provider credentials, migration review and real-store validation before revenue readiness can be claimed. Local tests do not prove any of these gates satisfied.
