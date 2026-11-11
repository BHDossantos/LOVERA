# Mobile dependency release gate

The partial Router58 upgrade cannot install alongside Expo57. This branch restores Router57.0.30 for the installed Expo57.0.32 SDK and regenerates a clean lockfile. It is an install/test repair, not complete mobile release approval.

Verified locally: fresh npm ci (no force or legacy-peer-deps), typecheck, lint0errors/8warnings,201tests. Expo's bundled/offline compatibility validation reports dependencies up to date; live versioned docs were unavailable (HTTP403), so no new Expo APIs were changed.

## Security gate remains

Router57 depends on query-string7/CommonJS and decode-uri-component0.2.2. Current npm production audit reports the decoder's malformed-percent-input denial-of-service advisory, surfaced through three high-severity dependency entries, plus four moderate entries. It is not correct to claim the security effect of Router58 was preserved. The registry's patched decoder0.5.1 is ESM and cannot be blindly substituted into the CommonJS caller.

Before store release, upgrade the Expo SDK, Router and all matching native modules together, then rerun native builds, device navigation/deep-link tests and security checks; or review and test an explicitly maintained compatible decoder remediation. Do not use force/legacy-peer-deps to hide the SDK58/57 peer mismatch. Do not call this branch production-security-ready or submit it to stores on the strength of a passing install alone.
