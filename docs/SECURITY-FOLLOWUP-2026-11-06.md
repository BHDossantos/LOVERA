# Mobile security follow-up — 2026-11-06

Local continuation of `2983c2380fdf10d86b336c3d1ea36491981cd721`; based on draft #52 and preserving #48 separately. No publishing, EAS action, provider call, production configuration or database change.

## Changes

- Resolve Expo's lazy global `fetch` during Jest setup while native mocks still exist. Previously Jest's teardown could first access the lazy getter after native mocks were disposed, triggering imports and warnings after tests finished: 191 passing assertions but exit 1. Eager resolution issues no request and retains Expo's implementation; it does not suppress failures.
- Resolve `expo-modules-core` and its subpaths from Expo's dependency tree in Jest. npm now nests this package below Expo; jest-expo's sibling imports otherwise fail before tests run. No application/runtime alias is changed.
- Apply upstream patches within SDK 57 with `expo install`: Expo 57.0.32, router 57.0.30, updates 57.0.27 and jest-expo 57.0.6. Align image-manipulator 57.0.22, image-picker 57.0.21, notifications 57.0.25 and splash-screen 57.0.11 to Expo's compatibility metadata. React19.2.3/RN0.86.3 remain unchanged. No SDK58 migration, forced npm audit fix or incompatible override.
- Upstream CLI57.0.33 replaces its Zod3 use with Expo schema utilities and uses patched glob14.0.4/minimatch11.0.5 paths. The resulting lockfile contains no zod or uuid package. node-forge1.4.3 protection remains.

## Audit

Fresh mobile lockfile audit: **15 entries: 3 high, 4 moderate, 8 low**, down from 24 at the previous candidate and 25 before node-forge remediation. Audit exits 1 because findings remain. An entry can be an affected ancestor, not a separate vulnerability.

- High: decode-uri-component0.2.2, inherited through query-string7.1.3 and expo-router. Latest SDK57 router still declares this path; patched decoder0.5.1 lies outside the declared range. npm recommends router58.0.30. A coordinated SDK upgrade or separately reviewed compatibility patch is still needed.
- Moderate: Expo fingerprint0.20.15 retains glob13.0.6/minimatch10.2.6. Even latest fingerprint0.21.9 metadata retains glob13/minimatch10. No incompatible override applied. Other Expo glob paths now use patched glob14.
- Low: deepmerge4.3.1 and Jest ancestors; no patched compatible release identified. npm proposes Jest25 downgrade, rejected.
- Web lockfile unchanged; fresh audit confirms six moderate minimatch ancestor entries (audit exit 1). No web build claimed here.

## Release limitations

TypeScript, unit tests and JS bundle exports cannot prove native compilation, installed-device behavior, permission handling, receipt delivery, real-store purchases or revenue readiness. Patch changes to native modules require a reviewed native build/release. The existing EAS main-push production workflow remains unchanged; local work must not be merged as an implicit approval to release.

Parent's current read-only inventory reports the free lovera-db expires today at 20:35 UTC. No retention/upgrade/backup action is authorized or performed here. Production availability and billing configuration remain separate unresolved gates.

## Final local validation

- Clean `npm ci --ignore-scripts --no-audit`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test -- --runInBand`: exit 0, 191 tests across 23 suites pass. No late teardown imports remain.
- Offline `expo install --check`: exit 0, dependencies up to date against bundled SDK metadata; remote React Native Directory compatibility was not checked.
- Offline `expo export --platform all`: exit 0, Android and iOS Hermes bundles generated at `/workspace/scratch/lovera-final-export-1106`. This is not native compilation or publishing.
- `npm run lint`: exit 1. Repository has no ESLint configuration; Expo attempts bootstrap installation of eslint/config but the default npm cache is unwritable. No lint configuration or lint dependency changes are included; lint remains a separate setup gate.
- Mobile and web audits: exit 1 for remaining findings above. `git diff --check`: exit 0.

Detailed command logs and audit JSON are under `/workspace/scratch/lovera-final-*-1106*`; web audit is `/workspace/scratch/lovera-web-final-audit-1106.json`. API code unchanged in this follow-up; prior 24 focused startup/configuration tests are not rerun or presented as full API coverage.
