#!/usr/bin/env python3
"""Assert that app.config.ts produced the native config we think it did.

`app.config.ts` is not the thing the stores read. Expo's prebuild turns it into an
AndroidManifest.xml and an Info.plist, and the gap between what you wrote and what came
out is where store rejections live: a permission you thought you had blocked, a purpose
string a plugin quietly added on your behalf, a splash colour that fell back to white.
None of it is visible from the config file, and none of it is covered by a typecheck.

So CI runs prebuild and this script reads the generated files. Run it after:

    npx expo prebuild --platform all --no-install --clean

Python rather than Node because plistlib parses a binary or XML plist from the standard
library, and the alternative is a dependency to read two files.
"""
from __future__ import annotations

import plistlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Permissions we must not ask for, each with the reason, so a future reader knows whether
# removing one from this list is a decision or a mistake.
MUST_NOT_REQUEST = {
    "ACCESS_FINE_LOCATION": "matching works on coarse zones; we never read a precise fix",
    "ACCESS_COARSE_LOCATION": "the member types their zone; we do not read location at all",
    "RECORD_AUDIO": "there is no voice feature",
    "SYSTEM_ALERT_WINDOW": "React Native's default; we draw no overlays",
    "WRITE_EXTERNAL_STORAGE": "the image picker's default; we write nothing to shared storage",
}
MUST_REQUEST = {
    "CAMERA": "profile photos and identity verification",
    "POST_NOTIFICATIONS": "introductions and safety messages",
    "READ_MEDIA_IMAGES": "choosing profile photos",
    "INTERNET": "every request",
}
# iOS purpose strings App Review reads. A plugin will supply a boilerplate string for a
# permission you never asked for, which reads as a feature the reviewer cannot find.
IOS_MUST_NOT_DECLARE = {
    "NSMicrophoneUsageDescription": "the image picker adds it for video capture; we take stills",
    "NSFaceIDUsageDescription": "SecureStore is never asked to gate the token behind biometrics",
}
IOS_MEMBER_FACING = ("NSCameraUsageDescription", "NSPhotoLibraryUsageDescription")
BRAND_BACKGROUND = "#fdf7f4"

failures: list[str] = []
# Counted as they run. The total used to be a hand-maintained sum of the table lengths plus a
# literal 7, so adding a check reported the old number -- the same "two things that must agree,
# computed separately" shape this repo keeps finding, and here it would quietly understate how much
# is actually being asserted.
ran = 0


def check(ok: bool, label: str, why: str = "") -> None:
    global ran
    ran += 1
    print(f"{'pass' if ok else 'FAIL'}  {label}" + (f"  ({why})" if why and not ok else ""))
    if not ok:
        failures.append(label)


def main() -> int:
    manifest_path = ROOT / "android/app/src/main/AndroidManifest.xml"
    plist_path = ROOT / "ios/Lovera/Info.plist"
    if not manifest_path.exists() or not plist_path.exists():
        print("Native projects are missing. Run:", file=sys.stderr)
        print("  npx expo prebuild --platform all --no-install --clean", file=sys.stderr)
        return 2

    manifest = manifest_path.read_text()
    colors = (ROOT / "android/app/src/main/res/values/colors.xml").read_text()
    plist = plistlib.load(plist_path.open("rb"))

    for perm, why in MUST_NOT_REQUEST.items():
        entry = re.search(rf'android:name="android\.permission\.{perm}"([^/]*)/>', manifest)
        # Absent is fine; present without tools:node="remove" is not, because the manifest
        # merger will pull it back in from a library that declares it.
        removed = entry is None or 'tools:node="remove"' in entry.group(1)
        check(removed, f"android: {perm} is not requested", why)

    for perm, why in MUST_REQUEST.items():
        check(f'android.permission.{perm}"/>' in manifest, f"android: {perm} is requested", why)

    check(
        'android:allowBackup="false"' in manifest,
        "android: cloud backup is off",
        "conversations and photos should not land in a backup nobody can audit",
    )
    check(
        BRAND_BACKGROUND in colors.lower(),
        "android: splash background is the brand colour",
        "an unconfigured splash falls back to white",
    )
    check(
        (ROOT / "android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png").exists(),
        "android: a splash logo was generated",
    )

    for key, why in IOS_MUST_NOT_DECLARE.items():
        check(key not in plist, f"ios: {key} is absent", why)

    for key in IOS_MEMBER_FACING:
        value = plist.get(key, "")
        check(
            value.startswith("Lovera"),
            f"ios: {key} is written for the member",
            f"got {value!r}, which is a plugin default",
        )

    check(plist.get("ITSAppUsesNonExemptEncryption") is False,
          "ios: the export-compliance answer is declared")
    check(plist.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoads") is False,
          "ios: cleartext traffic stays blocked")
    check(plist.get("UIUserInterfaceStyle") == "Light",
          "ios: the interface style is pinned")
    check(plist.get("CFBundleIdentifier", "").startswith("$("),
          "ios: the bundle id comes from the build setting prebuild wrote")

    # Over-the-air updates. The way OTA goes wrong is not failing to work, it is working on a binary
    # it should not have: a JS bundle calling a native module the installed app does not have crashes
    # on launch, and the member cannot get out of it. The runtime version is what prevents that, so
    # these assert what prebuild actually wrote rather than what app.config.ts intended.
    strings = (ROOT / "android/app/src/main/res/values/strings.xml").read_text()
    runtime = re.search(r'<string name="expo_runtime_version">([^<]*)</string>', strings)
    android_runtime = runtime.group(1) if runtime else ""
    android_url = re.search(r'EXPO_UPDATE_URL" android:value="([^"]*)"', manifest)
    # iOS keeps none of this in Info.plist — it is a separate Expo.plist, which is the kind of thing
    # this script exists to find out rather than assume. The first version of these checks read
    # Info.plist and reported the runtime version as absent.
    expo_plist_path = ROOT / "ios/Lovera/Supporting/Expo.plist"
    expo_plist = plistlib.load(expo_plist_path.open("rb")) if expo_plist_path.exists() else {}

    for label, is_on, url_value, runtime_value in (
        ("android", 'expo.modules.updates.ENABLED" android:value="true"' in manifest,
         android_url.group(1) if android_url else "", android_runtime),
        ("ios", expo_plist.get("EXUpdatesEnabled") is True,
         expo_plist.get("EXUpdatesURL", ""), expo_plist.get("EXUpdatesRuntimeVersion", "")),
    ):
        # Enabled without a manifest URL is the useless shape: the app polls nothing, an update can
        # never arrive, and everything behaves as though one could.
        check(not is_on or url_value.startswith("https://u.expo.dev/"),
              f"{label}: updates are enabled only with a manifest url",
              f"enabled={is_on} url={url_value!r}")
        # `appVersion` and `nativeVersion` leave a native change able to be served a JS bundle built
        # for a different one, and that crash happens on launch, so the member cannot get out of it.
        # `fingerprint` derives the runtime version from the native project, so it cannot drift.
        # EAS substitutes the real fingerprint at build time; `file:fingerprint` is the sentinel.
        check(not is_on or runtime_value == "file:fingerprint",
              f"{label}: the runtime version is the fingerprint policy",
              f"got {runtime_value!r}")

    # ---- iOS privacy manifest -------------------------------------------------------------
    #
    # There was none at all, which is an upload rejection: since 2024 every app on the App Store
    # has to carry one. The app-level obligations — whether it tracks, and what it collects — are
    # the app's own and are *not* covered by the manifests its SDKs ship for themselves, so an
    # empty or missing file is not "the SDKs have it handled".
    #
    # These assertions are about the two answers a reviewer compares against App Store Connect,
    # and about the one that is easy to get quietly wrong: a dating app that does not declare
    # sensitive info is not making an oversight, it is making a claim that will not survive
    # review, because who somebody is seeking is sexual-orientation data under Apple's taxonomy.
    privacy_path = ROOT / "ios/Lovera/PrivacyInfo.xcprivacy"
    check(privacy_path.exists(), "ios: a privacy manifest was generated", f"expected {privacy_path}")
    if privacy_path.exists():
        privacy = plistlib.loads(privacy_path.read_bytes())
        collected = {c.get("NSPrivacyCollectedDataType") for c in privacy.get("NSPrivacyCollectedDataTypes", [])}
        check(privacy.get("NSPrivacyTracking") is False,
              "ios: the manifest declares no cross-app tracking",
              f"got {privacy.get('NSPrivacyTracking')!r}")
        check(privacy.get("NSPrivacyTrackingDomains") == [],
              "ios: no tracking domains are declared",
              f"got {privacy.get('NSPrivacyTrackingDomains')!r}")
        check("NSPrivacyCollectedDataTypeSensitiveInfo" in collected,
              "ios: sensitive info is declared (who a member is seeking)",
              f"collected: {sorted(collected)}")
        check("NSPrivacyCollectedDataTypeOtherUserContent" in collected,
              "ios: member-written content is declared (messages, prompts, reports)")
        # Declaring what we do not collect is as wrong as omitting what we do, and this one is
        # checked in the same breath as the blocked location permissions above.
        check(not {"NSPrivacyCollectedDataTypePreciseLocation", "NSPrivacyCollectedDataTypeCoarseLocation"} & collected,
              "ios: no location is declared, because none is collected",
              f"collected: {sorted(collected)}")
        check(all(not c.get("NSPrivacyCollectedDataTypeTracking") for c in privacy.get("NSPrivacyCollectedDataTypes", [])),
              "ios: nothing collected is used for tracking")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"all {ran} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
