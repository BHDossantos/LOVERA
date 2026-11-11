# Post-merge SDK58 lock repair

Current main 3725f8f2 merged both the superseded SDK57 fallback and the SDK58 proposal. The resulting package lock differs from the tested SDK58 tree; CI43069617734 fails npm ci because @expo/log-box-utils 58.0.2 is missing.

Regenerated the dependency graph using npm 10 without force/legacy-peer-deps. Restored the one missing package entry and removed 21 unreachable entries. No retained package version changed. ESLint Expo config and Jest Expo remain development dependencies; duplicate runtime declarations were removed.

Validation: npm 10 and npm 11 clean installs pass, 201 mobile tests and TypeScript pass, lint has 0 errors and 8 pre-existing warnings. Production audit retains 5 moderate build-tool advisory entries and 0 high/critical. Hosted full pipeline must pass on the new exact commit before integration.

No application source, native permissions, production configuration, data, signing credentials or store submissions changed. Previous branch-green results do not establish that a subsequent merged lockfile is correct.
