# Store readiness follow-up — 2026-11-02

Keep this draft. Main pushes can trigger EAS production builds/submissions or OTA updates and container publishing. No merge, deployment, EAS lookup, native build, store submission, credential or setting change is authorized by this work.

## Receipt correction (updated 3 November)

Both native platforms now support authenticated RevenueCat server reconciliation when `MM_STORE_VALIDATION=revenuecat`. Set server-only `MM_REVENUECAT_SECRET_API_KEY`, configure the existing catalog SKUs in RevenueCat, and configure `MM_REVENUECAT_WEBHOOK_AUTHORIZATION` plus `/v1/webhooks/revenuecat`. Keep the existing platform public SDK keys in the mobile build. No credential or provider setting was changed here.

The server fetches only the signed-in member's customer record; mobile cannot select a different identity or claim a plan. Verified known store transactions, expiry/grace periods, sandbox rejection in production and receipt ownership determine access. Webhooks re-fetch provider state rather than trusting event grants. Expired/refunded subscriptions lose access. Temporary verification refusals can be retried. A charged purchase with an API outage tells the customer to restore instead of buy again. Store subscriptions use Apple/Google subscription management, not a misleading local cancel flag.

Direct iOS receipt verification remains available for its existing mode; Android requires RevenueCat mode rather than treating an order ID as a Google purchase token. Real sandbox/device purchase, renewal, restore, refund and offline-recovery tests are still release gates. Decide RevenueCat account-transfer behavior and resolve ownership conflicts through support before enabling production billing.

## Existing PRs and safety

- #48 remains open draft and includes the preflight repair and iOS export validation; review it separately. Its previously successful CI does not prove production EAS environment access, signing or submission readiness. No cloud build was triggered.
- #51 fails CI at mobile Jest: `react-native/unstable-internals-do-not-use` cannot resolve from Expo asset imports. Two suites fail to load, 19 pass / 145 tests pass. Head 37b9feab6535fcfdb167fde4be0df96b4acdf5dc, run 41312573286, job 124865851199. The PR upgrades Expo 57 to 58 while keeping the SDK 57/RN 0.86 stack. It needs a coordinated SDK migration and full native validation, not a mock hiding the missing internals. This branch leaves dependencies and that PR untouched.
- Safety subject, query-key and upload-type repository checks pass. Legal-facts check passes for drift but reports 12 operator values still absent: entity, address, markets, privacy/safety/support email, governing law, jurisdiction, consumer law, audit/safety retention and transfer mechanism. Do not invent these.
- Existing block/report/safety UI tests run locally. Actual moderation coverage, emergency escalation staffing, age/identity assurance, operator contact channels and incident response remain operational gates; test results do not establish that a live safety team exists.

## Validation

- Mobile TypeScript passes.
- Full mobile suite: 22 suites / 185 tests passed, including 18 purchase regressions.
- Full API suite: 201 passed on isolated local PostgreSQL 17, including RevenueCat and retry regressions.
- `python tools/check_safety_target.py`: 157 screens pass.
- `python tools/check_query_keys.py`: 123 operations pass.
- `python tools/check_upload_types.py`: 3 picker/API mappings pass.
- `python tools/check_legal_facts.py`: no drift; 12 missing operator facts remain.
- `CI=1 EXPO_NO_TELEMETRY=1 npm run lint` initially could not bootstrap its missing config through the proxy. A temporary SDK 57-aligned ESLint config/dependency installation subsequently ran and reported 33 errors / 10 warnings across existing screens and shared hooks (including React compiler rules). Temporary tooling changes were removed to avoid folding a broad lint migration into billing. Lint is not passed; this remains separate code-quality work.
- Signed native builds, sandbox store accounts and live receipt services were not exercised.

## Independent review follow-up

Subscription activation no longer cancels unrelated subscriptions. Each paid provider/product is retained, entitlement selection uses the highest eligible paid tier, and expiry/refund of one falls back to any remaining paid subscription. RevenueCat reconciles every active product; ownership is checked before reusing references. Member row locks serialize reconciliation, and concurrent cross-member receipt claims fail closed. A paid member cannot open a new checkout or see another native purchase offer. Native purchase also refreshes paid status immediately before invoking the SDK. Multiple subscriptions are disclosed individually; this does not cancel their external charges.

Previously granted direct iOS receipts are revalidated on restore. An authoritative refusal expires only that linked subscription, persists the refusal, and preserves unrelated paid access. An outage returns an error without extending the last verified term; access still ends at that verified expiry. Direct mode still lacks autonomous App Store server notifications: refunds are detected on restore, and term expiry is enforced locally. RevenueCat mode remains the intended configured lifecycle path.

Both SDK identity changes and whole purchase/restore operations share a queue. Verification is bound to the starting access token, never refreshed into another account, and stale screen completions are discarded. If an account changes mid-operation, sign back into the purchasing account and restore. Token rotation may conservatively require the same recovery. Nothing here reverses an external charge or guarantees no simultaneous purchase through a different device/provider; existing overlapping subscriptions require provider-side management.

Webhook identity resolution includes original IDs and aliases as required by RevenueCat's [subscriber identity fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields#subscriber-identity-fields). Only already-known member IDs are reconciled; aliases never create or link accounts. Each known account is fetched from the provider, and webhook payload plans are never grants. Unknown IDs are ignored, malformed/bounded identity lists fail closed. Account-transfer ownership conflicts still require the configured policy and support resolution.

Review validation: full API **216 passed** on local PostgreSQL; final billing subset **87 passed**, including concurrent same-member reconciliation and cross-member receipt claims. Full mobile **191 tests / 23 suites passed**; TypeScript passed. Direct restore revalidates inactive receipts and continues checking other receipts after a refusal, without falsely claiming a complete restore. Existing lint migration findings remain unresolved.
