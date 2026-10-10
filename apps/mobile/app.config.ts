import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Store-facing configuration. Both stores read most of their metadata from here, so the
 * values that are expensive to change later — the bundle identifier and the Android
 * package — are set once and never edited: the first upload binds them to the listing
 * permanently.
 *
 * Every permission carries a purpose string written in the member's language, not the
 * platform's. App Review rejects generic strings ("This app needs camera access"), and
 * they are the first thing a member reads about why we want something. Just as
 * importantly, permissions we do not use are switched off here rather than left to
 * default on: a dating app that asks for the microphone it never records with reads as
 * careless at best, and a reviewer who cannot find the feature behind a declared
 * permission rejects the build.
 */
const BUNDLE_ID = process.env.EXPO_PUBLIC_BUNDLE_ID ?? "com.aimatchmaker.app";

const BRAND_BACKGROUND = "#fdf7f4";
/** The action colour from the shared tokens. Keep in step with `src/theme.ts` and `globals.css`. */
const BRAND_ROSE = "#b42d55";

/**
 * Where the app sends every request. There is no sensible default for a real build:
 * Expo inlines this at bundle time, so a binary built against a placeholder installs
 * fine, launches fine, and then fails every single request — which is both an immediate
 * App Review rejection and the hardest kind of bug to see from the outside. So a build
 * for anything other than a developer's own machine has to say where the API is, and if
 * it cannot, the build stops here rather than at a reviewer's device.
 */
// Values that look like they were meant to be filled in. Kept deliberately broad: the
// cost of a false positive is a developer picking a different hostname, and the cost of a
// false negative is a signed binary that cannot talk to anything.
const PLACEHOLDER = /replace[-_ ]?me|change[-_ ]?me|example\.(com|org|net|test)|your[-_]|\bTODO\b|xxx/i;
// Addresses that are fine on a laptop and useless in anybody else's hands.
const LOCAL_ONLY = /localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0|\b10\.\d+\.\d+\.\d+\b|\b192\.168\./i;

function apiOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_API_ORIGIN?.trim();
  // EAS sets this on its builders; it is absent for `expo start` and for `expo export`.
  const profile = process.env.EAS_BUILD_PROFILE;
  const shipping = Boolean(profile) && profile !== "development";

  if (shipping) {
    const fix = `Set EXPO_PUBLIC_API_ORIGIN for the "${profile}" profile in eas.json and build again.`;
    if (!configured) {
      throw new Error(
        `EXPO_PUBLIC_API_ORIGIN is not set for the "${profile}" build profile.\n` +
          `Expo inlines the API origin at build time, so this binary could not reach any ` +
          `server at all. ${fix}`,
      );
    }
    if (PLACEHOLDER.test(configured) || LOCAL_ONLY.test(configured)) {
      throw new Error(
        `EXPO_PUBLIC_API_ORIGIN is not an address anyone else can reach for the ` +
          `"${profile}" profile: ${configured}\nEvery request in this build would fail. ${fix}`,
      );
    }
    if (!configured.startsWith("https://")) {
      throw new Error(
        `EXPO_PUBLIC_API_ORIGIN must be https for the "${profile}" profile, got ${configured}.\n` +
          `Release builds block cleartext HTTP on both platforms — Android by default and ` +
          `iOS through App Transport Security — so this build could not reach it. ${fix}`,
      );
    }
  }

  return configured || "http://127.0.0.1:8000";
}

/**
 * Expo mints push tokens against an EAS project, so a build without the project id can
 * never receive a notification. Introductions, replies and safety messages all arrive by
 * push, so that is not a degraded build, it is a broken one — and it fails silently, which
 * is worse. `eas build` cannot run before `eas init` has created the project, so requiring
 * the id costs a shipping build nothing.
 */
function easProjectId(): string | undefined {
  const configured = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile && profile !== "development" && (!configured || PLACEHOLDER.test(configured))) {
    throw new Error(
      `EXPO_PUBLIC_EAS_PROJECT_ID is ${configured ? `still a placeholder (${configured})` : "not set"} ` +
        `for the "${profile}" build profile.\nWithout it this build can never be issued a push ` +
        `token, so introductions would never reach anyone. Run \`npx eas-cli init\` and put the ` +
        `project id in eas.json for this profile.`,
    );
  }
  return configured;
}

/**
 * Over-the-air updates, so a fix after launch does not need a store review.
 *
 * Without `expo-updates`, every correction — a wrong string, a crash on one screen, a safety copy
 * fix — waits on App Review. For a product whose failure modes include safety notifications that
 * open nothing, that is the wrong trade.
 *
 * Two decisions here, and the second is the one that matters:
 *
 * `url` is the EAS project's manifest endpoint, so it cannot be formed before `eas init` has run.
 * Updates stay off until it can be (`enabled`), rather than shipping a binary that polls a URL
 * built from `undefined`. A shipping build already cannot get this far without the project id —
 * `easProjectId()` throws — so the off state only ever applies to a developer's own build.
 *
 * `runtimeVersion` is the policy that decides which binaries an update may be served to, and
 * getting it wrong is how OTA bricks an app: a JS bundle that calls a native module the installed
 * binary does not have will crash on launch, and the member cannot get out of it. `appVersion` and
 * `nativeVersion` both leave that as a discipline requirement — ship a native change without
 * remembering to bump the version and the mismatch is served to everyone. `fingerprint` derives the
 * runtime version from the native project itself, so a native change *is* a new runtime version
 * whether anybody remembered or not. EAS resolves it at build time; locally `expo config` reports
 * the `file:fingerprint` sentinel, which is why check-native-config.py accepts that value.
 *
 * `fallbackToCacheTimeout: 0` is also deliberate: the app launches on the bundle it already has and
 * applies anything it downloaded on the next launch. The alternative blocks the splash screen on a
 * network round trip, which is a worse first impression than being one launch behind.
 */
function updates(projectId: string | undefined): ExpoConfig["updates"] {
  if (!projectId) return { enabled: false };
  return {
    enabled: true,
    url: `https://u.expo.dev/${projectId}`,
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
  };
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "AI Matchmaker",
  slug: "ai-matchmaker",
  scheme: "aimatchmaker",
  version: "1.0.0",
  /**
   * Declared, because the default is not what it looks like: Expo adds "web" to this list whenever
   * `react-dom` is installed, and it is — pulled in through the toolchain, not by us. There is no
   * `react-native-web` here and no web layout, so web is a platform this app cannot build, and
   * leaving it in the list is not cosmetic. Anything that bundles "every platform in the config"
   * then fails: `expo export --platform all` does, and so would `eas update`, which is the publish
   * step the whole over-the-air story depends on. Found by running the export.
   */
  platforms: ["ios", "android"],
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  primaryColor: BRAND_ROSE,
  extra: {
    apiOrigin: apiOrigin(),
    eas: { projectId: easProjectId() },
    // RevenueCat's *public* SDK keys, which are designed to ship in a client binary — they can
    // start a purchase and read entitlements, and they cannot refund, grant or read anybody
    // else's data. The secret key stays on the server and is not referenced here. Absent, the
    // app simply never offers an in-app purchase; see src/lib/purchases.ts.
    revenueCat: {
      ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? null,
      android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? null,
    },
  },
  // Read from the native project rather than from `version`, so a native change cannot be served a
  // JS bundle that expects a different one. See `updates()`.
  runtimeVersion: { policy: "fingerprint" },
  updates: updates(easProjectId()),
  ios: {
    bundleIdentifier: BUNDLE_ID,
    // Phone-first: a dating app laid out for iPad invites "does not work well on iPad"
    // rejections under guideline 2.4.1, and we have no tablet layouts.
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSCameraUsageDescription:
        "AI Matchmaker uses the camera so you can take a profile photo and complete identity verification.",
      NSPhotoLibraryUsageDescription:
        "AI Matchmaker needs your photo library so you can choose the photos that appear on your profile.",
      NSUserTrackingUsageDescription:
        "AI Matchmaker does not track you across other companies' apps or websites.",
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: BRAND_BACKGROUND,
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    // Members' conversations, introductions and photos are not something to hand to a
    // cloud backup that neither they nor we can see into. expo-secure-store already
    // excludes the keychain entries; this excludes everything else.
    allowBackup: false,
    permissions: [
      "android.permission.CAMERA",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.READ_MEDIA_IMAGES",
    ],
    // We never ask for precise location: matching works on coarse zones, and asking for
    // more than we use is both a Play Data safety liability and a trust cost.
    // SYSTEM_ALERT_WINDOW and WRITE_EXTERNAL_STORAGE arrive by default from React Native
    // and the image picker; we draw no overlays and write nothing to shared storage, and
    // both are permissions Play asks pointed questions about.
    blockedPermissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
  },
  plugins: [
    "expo-router",
    // Without this, `userInterfaceStyle` above is silently ignored on Android.
    "expo-system-ui",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 180,
        resizeMode: "contain",
        backgroundColor: BRAND_BACKGROUND,
      },
    ],
    [
      "expo-secure-store",
      {
        // We store a refresh token, and never ask SecureStore to gate it behind
        // biometrics. Declaring Face ID we do not use earns a 5.1.1 rejection for a
        // purpose string that describes no feature.
        faceIDPermission: false,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "AI Matchmaker needs your photo library so you can choose the photos that appear on your profile.",
        cameraPermission:
          "AI Matchmaker uses the camera so you can take a profile photo and complete identity verification.",
        // The picker declares microphone access because it can capture video. We only
        // ever take stills, so this comes off: an unused permission with a boilerplate
        // purpose string is exactly what App Review looks for.
        microphonePermission: false,
      },
    ],
    [
      "expo-notifications",
      {
        color: BRAND_ROSE,
        defaultChannel: "introductions",
      },
    ],
  ],
});
