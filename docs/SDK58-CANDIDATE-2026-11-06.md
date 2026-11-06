# SDK58 candidate — 2026-11-06

Separate migration stacked on PR55; not a production release. Base includes cf3fa40 (Node22/npm10 SDK57 lock repair) and c76c15c (production mail test correction). SDK58 uses its own regenerated lock, not SDK57 optional peer entries.

## Change and evidence

Expo58.0.22 / Router58.0.30 / React19.3.0 / RN0.88.1, using Expo-recommended package alignment. Jest30.5.2 and explicit react-test-renderer19.3.0 preserve the existing test harness. No force, legacy peer-deps, or incompatible transitive overrides. Small RN type corrections and named notification imports preserve behavior. query-string and decode-uri-component are absent from this lockfile.

Node22.23.4/npm10.9.9: package-lock-only regeneration and clean npm ci --ignore-scripts --no-audit exit0; typecheck exit0; 24 suites /197 tests pass, exit0. Install scripts were intentionally not executed. Existing Jest fake-timer/deprecation warnings remain.

Final Android and iOS JavaScript/Hermes exports under Node22.23.4 exit0; this is not a native build or device validation. Artifact: /workspace/scratch/lovera-sdk58-final-export.

Lint exits1 with the pre-existing6 errors /10 warnings, without rule suppression. Errors: dates/new.tsx (two state-in-effect findings), membership.tsx callback declaration ordering, onboarding/blueprint/interview.tsx answer reset, AvailabilityEditor.tsx draft reset, ProfileEditor.tsx draft reset. No new lint errors.

Expo install --check exits0 using offline bundled metadata (remote validation unavailable). expo-doctor1.21.6 exits1:18/20 pass; config schema request fails DNS EAI_AGAIN for exp.host and React Native Directory request fails. These remote checks remain unverified. Native prebuild, device builds, RevenueCat purchases/restores, notification delivery, secure-storage migration and OTA compatibility are not validated.

## Dependency audit

Same npm10.9.9: SDK57 full22 (3high/11moderate/8low); SDK58 full31 (0high/30moderate/1low), production-filtered5moderate. This removes the high decoder chain but increases moderate ancestor counts with the current Jest/Expo tooling; it is not an all-clear. npm11.9 reports60 full (59moderate/1low),34moderate production due to ancestor propagation; counts are tool-version dependent.

Three distinct remaining advisories:
- glob GHSA-3g3m-2fjr-6pw4, cancellation bypass / filesystem traversal after timeout, affected9–14.0.1. Used by Expo CLI and Jest tooling.
- minimatch GHSA-g3hv-75wg-m249, globparts denial of service, affected>=7<11.0.1. Used by Expo fingerprint, TypeScript-ESLint, glob and test-exclude tooling.
- deepmerge GHSA-gcqx-w48m-w2h4, returned-object prototype poisoning, affected4.2–4.3.1, Jest config path; low severity.

The five npm10 production-tree findings are Expo fingerprint/glob/minimatch ancestors, because Expo tooling ships under production dependencies. No direct mobile screen imports of these packages were identified; this does not prove every runtime path safe. Upstream compatible releases/validated targeted changes remain needed; no forced major glob/minimatch override was made.

## Release hold

Do not merge to main yet: apps/mobile/.eas/workflows/deploy.yml automatically launches native builds/submissions or production OTA on main pushes. Require successful native builds and device smoke tests, online doctor validation, resolution/acceptance of remaining lint/advisories, provider configuration verification and database recovery/preservation before release. No EAS build, OTA, store submission, production configuration, paid plan, merge or deployment performed.

References: https://docs.expo.dev/versions/v58.0.0/ ; https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/ ; https://expo.dev/changelog/sdk-58 .
