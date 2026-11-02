# Store readiness follow-up — 2026-11-02

Keep this draft. Main pushes can trigger EAS production builds/submissions or OTA updates and container publishing. No merge, deployment, EAS lookup, native build, store submission, credential or setting change is authorized by this work.

## Receipt correction

RevenueCat 10.12.2 exposes `subscriptionsByProductIdentifier` and `storeTransactionId` (verified in installed TypeScript declarations). iOS restore now submits genuine active App Store subscription transactions to the existing server verifier. Product/member concatenations are never submitted as receipts. Duplicate IDs are replayed once; missing receipts and partial restores return failure instead of claiming success. Existing non-subscription iOS replay remains supported. A 200 response only counts as success when the server reports a grant and paid entitlements; refused-receipt replays cannot become false success. The existing backend permanently caches refusal rows, including temporary verifier outages, so retryable-refusal reconciliation remains a backend release gate.

Google Play verification expects a purchase token, while the current SDK path returns a transaction/order identifier. Android purchase availability and the purchase function now fail before charging; restore reports the limitation. Remaining work: an authenticated server-side RevenueCat reconciliation path or a native purchase-token bridge, renewal/refund handling and sandbox/device purchase/restore tests. No customer is charged in tests. No client-provided entitlement is trusted as a server grant.

## Existing PRs and safety

- #48 remains open draft and includes the preflight repair and iOS export validation; review it separately. Its previously successful CI does not prove production EAS environment access, signing or submission readiness. No cloud build was triggered.
- #51 fails CI at mobile Jest: `react-native/unstable-internals-do-not-use` cannot resolve from Expo asset imports. Two suites fail to load, 19 pass / 145 tests pass. Head 37b9feab6535fcfdb167fde4be0df96b4acdf5dc, run 41312573286, job 124865851199. The PR upgrades Expo 57 to 58 while keeping the SDK 57/RN 0.86 stack. It needs a coordinated SDK migration and full native validation, not a mock hiding the missing internals. This branch leaves dependencies and that PR untouched.
- Safety subject, query-key and upload-type repository checks pass. Legal-facts check passes for drift but reports 12 operator values still absent: entity, address, markets, privacy/safety/support email, governing law, jurisdiction, consumer law, audit/safety retention and transfer mechanism. Do not invent these.
- Existing block/report/safety UI tests run locally. Actual moderation coverage, emergency escalation staffing, age/identity assurance, operator contact channels and incident response remain operational gates; test results do not establish that a live safety team exists.

## Validation

- Mobile TypeScript passes.
- Full mobile suite: 22 suites / 180 tests passed, including 13 receipt regressions.
- `python tools/check_safety_target.py`: 157 screens pass.
- `python tools/check_query_keys.py`: 123 operations pass.
- `python tools/check_upload_types.py`: 3 picker/API mappings pass.
- `python tools/check_legal_facts.py`: no drift; 12 missing operator facts remain.
- `CI=1 EXPO_NO_TELEMETRY=1 npm run lint` attempted: no ESLint config; automatic setup hits a proxy Forbidden response. Lint is not claimed as passed.
- Signed native builds, sandbox store accounts and live receipt services were not exercised.
