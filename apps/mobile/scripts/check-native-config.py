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
BRAND_BACKGROUND = "#faf7f1"

failures: list[str] = []


def check(ok: bool, label: str, why: str = "") -> None:
    print(f"{'pass' if ok else 'FAIL'}  {label}" + (f"  ({why})" if why and not ok else ""))
    if not ok:
        failures.append(label)


def main() -> int:
    manifest_path = ROOT / "android/app/src/main/AndroidManifest.xml"
    plist_path = ROOT / "ios/AIMatchmaker/Info.plist"
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
            value.startswith("AI Matchmaker"),
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

    print()
    if failures:
        print(f"{len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"all {len(MUST_NOT_REQUEST) + len(MUST_REQUEST) + len(IOS_MUST_NOT_DECLARE) + len(IOS_MEMBER_FACING) + 7} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
