# Dependency recheck and native-link mitigation — November 6

Remote PR55 and local candidate both started at36513235; main36f6858 unchanged. Checked mobile AGENTS instructions and official Expo native-intent documentation. No package versions, overrides, credentials, production settings or database state changed in this follow-up.

## Fresh audits

| Lockfile audit | High | Moderate | Low | Exit |
| --- | ---: | ---: | ---: | ---: |
| Mobile all dependencies | 3 | 11 | 8 | 1 |
| Mobile omit-dev | 3 | 4 | 0 | 1 |
| Web all dependencies | 0 | 6 | 0 | 1 |
| Web omit-dev | 0 | 0 | 0 | 0 |

These are affected-package entries, including ancestors. No current ws advisory appears in either audit. Mobile resolves ws7.5.13, Expo CLI ws8.22.1 and jsdom ws8.22.0; do not transfer old ws findings to this candidate without new evidence.

## Exact remaining exposure and resolution

- **High, application routing:** expo-router57.0.30 → query-string7.1.3 → decode-uri-component0.2.2. Router's `build/react-navigation/core/getStateFromPath.js` calls queryString.parse in parseQueryParams (line499 in this installation); other route serialization modules import query-string too. Malformed percent-encoded input invokes the vulnerable fallback decoder. The patched decoder0.5.1 is ESM and outside query-string's^0.2.2 range. Router imports query-string as CommonJS named exports. No compatible patched release was found. Registry metadata for latest expo-router58.0.30 was checked: it no longer declares query-string or decode-uri-component directly, so this exact direct chain is removed there. Its native dependencies target newer versions (including React Native normalize-colors0.88.1 and screens4.30.1), so it is not a drop-in SDK57 fix. A coordinated SDK58 migration is a concrete candidate resolution for this chain, but its complete resolved tree and application behavior have NOT been validated. An alternative is a separately reviewed and maintained CommonJS backport; neither is equivalent to forcing a lockfile override.
- **Moderate, Expo tooling:** expo → @expo/fingerprint0.20.15 → glob13.0.6/minimatch10.2.6. These packages appear in npm's production dependency graph, but fingerprinting is build/update tooling, not evidence that the vulnerable filesystem traversal runs inside a member screen. Latest fingerprint0.21.9 still declares glob^13/minimatch^10. No compatible upstream patch found. Do not use npm's suggested Expo52 downgrade.
- **Moderate, lint tooling:** mobile eslint-config-expo57.0.2 and web eslint-config-next15.5.28 → TypeScript ESLint → minimatch10. Latest installed parser/typescript-estree8.72.1 still declares minimatch^10.2.2; patched minimatch11 is outside the supported range. A compatible upstream parser/toolchain release or reviewed override is needed. Web omit-dev audit is zero.
- **Low, test tooling:** Jest29/jest-expo → deepmerge4.3.1. No patched compatible deepmerge release found. Do not downgrade to Jest25 to satisfy npm's proposal.

## Safe bounded mitigation delivered

`app/+native-intent.ts` validates percent encoding with the built-in decoder and bounds input to8192 characters before returning native system links to Router. Valid links are returned byte-for-byte unchanged, preserving escaped separators, callback references, duplicate parameters and plus signs. Malformed or oversized links return `/` through the app's normal authentication/routing flow.

This covers links delivered to Expo's native-intent hook for cold and warm native entry. It does NOT remove the vulnerable package, cover Expo web routing or arbitrary internal calls to query-string, or establish native-device protection before a reviewed build/release. It does not claim to eliminate every possible decoding path. All high advisories remain open.

Tests cover cold/warm flags, normal/custom/universal links, percent-encoded callback references, malformed UTF-8/percent sequences, many distinct encoded runs and oversized input. This is a guard test, not a device-link integration test.

## Validation

- TypeScript exit0.
- Jest exit0:197 tests across24 suites.
- Lint exit1: unchanged6 semantic errors/10 warnings; new guard adds no finding.
- Android/iOS Hermes exports exit0 locally; see final output log `/workspace/scratch/lovera-intent-export.log`.
- Audit JSON: `/workspace/scratch/lovera-mobile-audit-latest.json`, `lovera-web-audit-latest.json`, `lovera-mobile-prod-audit-latest.json`, `lovera-web-prod-audit-latest.json`.
- Test/type/lint logs: `/workspace/scratch/lovera-intent-{tests,typecheck,lint}.log`.

Official references: https://docs.expo.dev/router/advanced/native-intent/ ; https://github.com/advisories/GHSA-qr28-fpjm-wq7f ; https://github.com/SamVerschueren/decode-uri-component/releases/tag/v0.5.1 . Registry metadata and installed importer source were checked directly. There is no claim that all dependency issues are fixed.

## Release gates

Parent owns urgent database retention/recovery. No database upgrade, access-rule change, backup or paid service action here. PR55 stays draft: no merge, native build/submission or OTA delivery. Existing main-push EAS triggers remain a release hold; database preservation, verified runtime secrets/SMTP and residual dependency/tooling issues remain unresolved.
