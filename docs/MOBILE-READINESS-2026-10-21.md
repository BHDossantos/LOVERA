# Mobile automation audit (2026-10-21)

## Verdict

LOVERA already has a substantive Expo 57 / React Native app in `apps/mobile`: onboarding, introductions, messages, dates, safety, profile/privacy and membership screens; secure storage, push and purchase integration; EAS profiles; native permission/config guards; route/API-contract checks; and UI/unit tests. It is materially beyond the old `mobile/dating-eas-automation` branch. Do not replace current main with that older branch.

Main's CI passed at `e8cc8b3116ce952bd5fd4c58a28fb6a1c20ed937` ([run](https://github.com/BHDossantos/LOVERA/actions/runs/38822970385)). This is evidence of code validation, not proof of a signed build, store approval, functioning production backend or monetization.

## Changes

- Added the missing iOS Metro export alongside the Android export in existing CI. Platform-specific imports can fail on only one platform.
- Corrected the manual GitHub build preflight. `eas.json` selects named EAS environments and contains no inline `env` blocks, but the old preflight read only those absent blocks and explicitly exported empty values, causing the shipping guards to reject every profile.
- The preflight now resolves the existing project using `EXPO_PUBLIC_EAS_PROJECT_ID`, reads the profile's selected environment, and uses `eas env:exec` before checking the shipping app config. It deliberately does not set the shipping profile until inside that command, because project lookup evaluates the config before remote environment values are available.
- Corrected the OTA command example to include `--environment` as required by SDK 55+.

Reference: [Expo environment-variable usage](https://docs.expo.dev/eas/environment-variables/usage/). Public config values must be available to CLI configuration resolution; a secret-only EAS variable is not readable there. Nothing in this PR creates an EAS project, token, signing identity or store listing, or changes the app's IDs.

## Required operator checks before a build

1. Confirm the existing EAS project ID is set in the documented GitHub repository variable and matches `EXPO_PUBLIC_EAS_PROJECT_ID` in each selected EAS environment.
2. Confirm `EXPO_PUBLIC_API_ORIGIN` points at the intended reachable HTTPS API in each environment. Values must not be placeholders. This audit did not inspect private environment values or credentials.
3. Confirm the existing `EXPO_TOKEN` and signing/store configuration through their normal secure management process. The manual build and optional submission have not been invoked.
4. Read `docs/LAUNCH-READINESS.md`, `docs/LAUNCH-RUNBOOK.md`, `docs/STORE-SUBMISSION.md` and `docs/STORE-PRIVACY-ANSWERS.md`. Repository documentation still calls out production service/operator gates; code CI cannot close those.
5. Run real-device onboarding/auth expiry, denied permissions, push/deep links, offline/reconnect, safe-area/keyboard, purchase/restore and account deletion journeys against an approved staging backend. No Maestro/native device suite was found.

## Important existing behavior

`apps/mobile/.eas/workflows/deploy.yml` is already configured on pushes to main and can publish production OTA updates or build/submit store binaries when integrated with EAS. This audit did not create, enable, trigger or modify that pipeline. Keep this change in draft until reviewed; merging is not authorized by the audit request.

## Verification

- Passed locally: clean mobile install, TypeScript check and all 167 tests across 21 suites. Existing tests emit fake-timer warnings; they are not failures.
- The existing `npm run lint` script has no ESLint configuration/dependencies to execute; automatic setup failed in this environment. Lint is not claimed as passed and is not silently auto-configured in this PR.
- Android/iOS export and generated-native-config validation results should be checked in the PR CI. EAS environment lookup and signed builds were intentionally not executed because they require the actual account setup and approval of build usage.
