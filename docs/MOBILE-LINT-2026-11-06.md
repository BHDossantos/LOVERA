# Mobile lint setup — 2026-11-06

Follow-up to candidate `df40c78f9381bc134418443325d9c2b657a06c78` on the same local branch. Added exact dev dependencies eslint9.39.5 and eslint-config-expo57.0.2 using Expo install and `/workspace/scratch/lovera-npm-cache`, without changing HOME. Uses the stock Expo flat config with no disabled rules, suppressions, extra excludes, automatic fixes in the setup commit. A subsequent mechanical fix escapes JSX text entities without changing displayed content. Guidance: https://docs.expo.dev/guides/using-eslint/ . SDK57 requests ESLint9; npm marks this version unsupported upstream. A future supported tooling migration remains necessary.

## Results

- `npm run lint`: exit1, **34 errors and10 warnings**. Lint is now configured and executes, but the app is not lint-clean.
- `npm run typecheck`: exit0.
- `npm test -- --runInBand`: exit0, **191 tests/23 suites**.
- `npm audit --package-lock-only`: exit1, **22 entries:3 high/11 moderate/8 low**. Previously15; seven additional moderate ancestor entries are from TypeScript ESLint's minimatch10 dependency. Installed latest parser/typescript-estree8.72.1 still declares minimatch^10.2.2. No incompatible override or npm-proposed config downgrade was applied. These additional dependencies are development lint tooling, not a resolved security-clean state.
- No existing dependency at the same lockfile path changed version; npm added212 packages and rehoisted the tree. The larger lockfile diff reflects installing the linter, not upgrading application dependencies.
- No production, provider, release, merge, push or external repository action occurred. Prior candidate remains available unchanged at its commit.

## Findings by rule

- @typescript-eslint/no-redeclare: 1 warnings
- @typescript-eslint/no-unused-vars: 7 warnings
- import/no-duplicates: 2 warnings
- react-hooks/immutability: 2 errors
- react-hooks/purity: 1 errors
- react-hooks/refs: 8 errors
- react-hooks/set-state-in-effect: 6 errors
- react/no-unescaped-entities: 17 errors

Hook findings require reviewed behavioral fixes, especially introduction reporting callbacks, render-time refs and effect-driven initialization. They are static findings, not proof every flagged location is a runtime defect. String escaping and unused imports can be addressed separately without disabling checks.

## File inventory

| File | Errors | Warnings |
| --- | ---: | ---: |
| `app/(app)/dates/[dateId].tsx` | 2 | 1 |
| `app/(app)/dates/[dateId]/feedback.tsx` | 2 | 0 |
| `app/(app)/dates/[dateId]/safety.tsx` | 2 | 0 |
| `app/(app)/dates/new.tsx` | 2 | 0 |
| `app/(app)/dates/venues.tsx` | 0 | 1 |
| `app/(app)/introductions/[id]/index.tsx` | 7 | 0 |
| `app/(app)/introductions/[id]/mutual.tsx` | 1 | 0 |
| `app/(app)/introductions/index.tsx` | 1 | 0 |
| `app/(app)/introductions/waiting.tsx` | 0 | 1 |
| `app/(app)/messages/index.tsx` | 1 | 0 |
| `app/(app)/today.tsx` | 0 | 2 |
| `app/(app)/you/blueprint.tsx` | 1 | 0 |
| `app/(app)/you/index.tsx` | 2 | 0 |
| `app/(app)/you/membership.tsx` | 1 | 2 |
| `app/(app)/you/preferences.tsx` | 1 | 1 |
| `app/(app)/you/verification.tsx` | 1 | 0 |
| `app/_layout.tsx` | 1 | 0 |
| `app/onboarding/blueprint/interview.tsx` | 1 | 0 |
| `app/onboarding/intent.tsx` | 3 | 0 |
| `app/safety/index.tsx` | 1 | 0 |
| `src/components/AvailabilityEditor.tsx` | 1 | 0 |
| `src/components/CorrectionForm.tsx` | 0 | 2 |
| `src/components/ProfileEditor.tsx` | 1 | 0 |
| `src/components/ui.tsx` | 1 | 0 |
| `src/lib/query.ts` | 1 | 0 |

Full findings with line numbers and messages: `/workspace/scratch/lovera-lint-findings.json`. Human-readable run: `/workspace/scratch/lovera-lint-configured.log`. Audit: `/workspace/scratch/lovera-lint-audit.json`. Test/typecheck logs: `/workspace/scratch/lovera-lint-tests.log` and `/workspace/scratch/lovera-lint-typecheck.log`.

## Final mechanical follow-up

Escaped 17 apostrophe/quotation occurrences in JSX text across 11 files, with targeted inspected edits. No hook behavior or lint rules changed. Final lint exits1 with **17 errors and10 warnings**; TypeScript exits0 and all191 tests/23 suites pass with exit0. Dependency audit remains22 entries (3 high,11 moderate,8 low); the mechanical source edits do not change its lockfile. Original inventory above records initial findings; final inventory is `/workspace/scratch/lovera-lint-remaining.json`.

Remaining error locations requiring semantic review:

- `app/(app)/dates/new.tsx:41` — `react-hooks/set-state-in-effect`
- `app/(app)/dates/new.tsx:74` — `react-hooks/set-state-in-effect`
- `app/(app)/introductions/[id]/index.tsx:142` — `react-hooks/immutability`
- `app/(app)/introductions/[id]/index.tsx:174` — `react-hooks/refs`
- `app/(app)/introductions/[id]/index.tsx:174` — `react-hooks/refs`
- `app/(app)/introductions/[id]/index.tsx:174` — `react-hooks/refs`
- `app/(app)/introductions/[id]/index.tsx:175` — `react-hooks/refs`
- `app/(app)/introductions/[id]/index.tsx:175` — `react-hooks/refs`
- `app/(app)/introductions/[id]/index.tsx:175` — `react-hooks/refs`
- `app/(app)/you/membership.tsx:78` — `react-hooks/immutability`
- `app/(app)/you/verification.tsx:73` — `react-hooks/purity`
- `app/_layout.tsx:12` — `react-hooks/refs`
- `app/onboarding/blueprint/interview.tsx:79` — `react-hooks/set-state-in-effect`
- `src/components/AvailabilityEditor.tsx:47` — `react-hooks/set-state-in-effect`
- `src/components/ProfileEditor.tsx:38` — `react-hooks/set-state-in-effect`
- `src/components/ui.tsx:101` — `react-hooks/set-state-in-effect`
- `src/lib/query.ts:94` — `react-hooks/refs`

Final logs: `/workspace/scratch/lovera-lint-mechanical.log`, `/workspace/scratch/lovera-lint-mechanical-typecheck.log`, `/workspace/scratch/lovera-lint-mechanical-tests.log`. Some ref findings are on event-handler factories and need human review of the static analyzer's inference; no suppressions were added to treat them as proven harmless.
