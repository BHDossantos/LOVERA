# Coordinated SDK 58 validation — 11 November 2026

This proposal supersedes the SDK57 fallback PR58. Main mixed Expo57 with Router58, causing ERESOLVE. The fallback restored compatibility but reintroduced vulnerable decode-uri-component and its hosted npm10 installation also exposed a missing optional peer lock entry. Do not merge both proposals.

Versions were selected using Expo58.0.23's published bundledNativeModules compatibility map and installed through the Expo CLI. Runtime, development preset, React19.3/RN0.88, Jest30 and explicitly imported test renderer were upgraded together. CLI-recommended status-bar and web-browser config plugins were added. Native output is generated, never hand-edited. Source adjustments preserve existing notification importance values, supply undefined for an absent FlatList header and update the Linking.openURL test mock to its void result.

Local validation:
- Fresh npm11 ci AND npm10 ci succeed without force/legacy-peer-deps.
- All 201 tests across24 suites pass; typecheck passes; lint has0 errors and8 existing warnings.
- Android and iOS Metro exports succeed.
- Native prebuild succeeds and all34 generated-manifest checks pass.
-61 navigation targets and43 API paths resolve to47 registered routes.
- Offline Expo dependency check says current. Online versioned documentation was inaccessible (403); offline validation is explicitly not an online compatibility guarantee.
- Production dependency audit:0 high/critical,5 moderate entries caused by build-tool glob/minimatch dependencies. Those advisories remain unresolved. No security downgrade to Expo52 was accepted.

Hosted CI, physical-device behavior, signed native builds, store credentials/privacy declarations and production API/provider acceptance remain separate release gates. No store submission, production deployment, paid service or live payment was performed.
