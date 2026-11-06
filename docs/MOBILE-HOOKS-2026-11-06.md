# Mobile hook review — 2026-11-06

Local follow-up to `afe54cefed88620e2c7a3baec539389fee258608`. Reviewed all 17 hook errors without disabling any rules. No billing/provider/identity configuration, remote API, deployment, publication or repository action was performed.

## Fixed

- Root layout creates its QueryClient once with lazy state, avoiding allocating unused clients and reading a mutable ref during render.
- `useAwaitingServer` updates its refetch callback ref in a layout effect after commit, preserving callback identity without letting an abandoned render replace the callback seen by focus/app-state listeners.
- Introduction explanation reporting uses a named recursive callback and explicit layout event closures. Its cumulative section set, single in-flight request, pending union and retry behavior are unchanged. The handler-factory warnings were static-analysis ambiguity: refs were actually accessed in layout events, not during render. Explicit event closures express that boundary without suppressing the rule.
- Verification expiry reads a state-backed clock, refreshed every minute with cleanup, instead of calling Date.now in render. An open screen now transitions into the warning window without needing an unrelated render.
- Photo loading is scoped to its URL with a keyed child. Switching the URL resets loading state before commit and cancels the old effect, preventing an old photo from remaining visible while the new member's photo loads. No synchronous effect state reset is needed.

Added two behavioral regression tests: an old photo response cannot overwrite a new URL, clearing the URL removes the image; and an open verification screen warns after crossing the expiry threshold. Existing introduction concurrency/reporting, freshness, authentication and billing suites remain passing.

## Exact verification

- TypeScript: exit0.
- Jest final run: exit0, **193 tests across23 suites pass**. The first new expiry test failed because it advanced timers without enabling a fake clock; corrected test setup and reran the full suite successfully.
- ESLint over app/src: exit1, **6 errors and10 warnings**, down from17 errors. No rule overrides/suppression.
- Offline Expo export: exit0, Android and iOS Hermes bundles at `/workspace/scratch/lovera-hooks-export`. Native compilation/device behavior not verified.
- `git diff --check`: exit0.
- Dependency files unchanged from lint setup. Latest audit evidence remains exit1, **22 entries:3 high,11 moderate,8 low**, in `/workspace/scratch/lovera-lint-audit.json`; not represented as a newly rerun audit.

Evidence: `/workspace/scratch/lovera-hooks-typecheck.log`, `/workspace/scratch/lovera-hooks-tests-final.log`, `/workspace/scratch/lovera-hooks-final-lint.json`, `/workspace/scratch/lovera-hooks-export.log`.

## Six remaining errors

- `app/(app)/dates/new.tsx:41`: synchronous error reset when the planner loads a different member/conversation/plan. A safe redesign should key loading/error/plan state to the complete request identity; simply deleting the reset leaves stale errors.
- `app/(app)/dates/new.tsx:74`: start-time reset when the chosen overlap changes. Move to an explicit selection model with tests for new windows, manual start choice and availability refetch. Do not retain an old slot that is invalid for a new window.
- `app/(app)/you/membership.tsx:78`: the generation effect references setBusy before its declaration. JavaScript executes the effect after initialization, so this is not itself a temporal-dead-zone runtime crash. Moving declarations alone exposes the state-in-effect warning. A fuller identity-keyed busy model must retain generation increments and invalidate late purchase/restore callbacks across account switches; billing concurrency is deliberately unchanged here.
- `app/onboarding/blueprint/interview.tsx:79`: answer fields reset on question identity/preference change. A keyed question editor or equivalent guarded initialization needs tests proving answers and preference defaults cannot carry across questions.
- `src/components/AvailabilityEditor.tsx:47`: initializes an editable draft once from a server response. Separate loading from draft mount and preserve intentionally empty saved windows/styles and ongoing edits across refetch.
- `src/components/ProfileEditor.tsx:38`: initializes form from the first server profile. A draft component must preserve unsaved edits and server version semantics across upload/save/refetch.

These six are precise remaining review items, not proof of six observed production failures. New render-ref and stale-image hazards were fixed; deeper draft/identity lifecycles were left intact. Main-push EAS release controls and database retention remain separate parent-owned gates.
