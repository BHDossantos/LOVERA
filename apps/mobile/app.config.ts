import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Store-facing configuration. Both stores read most of their metadata from here, so the
 * values that are expensive to change later — the bundle identifier and the Android
 * package — are set once and never edited: the first upload binds them to the listing
 * permanently.
 *
 * Every permission carries a purpose string written in the member's language, not the
 * platform's. App Review rejects generic strings ("This app needs camera access"), and
 * they are the first thing a member reads about why we want something.
 */
const BUNDLE_ID = process.env.EXPO_PUBLIC_BUNDLE_ID ?? "com.aimatchmaker.app";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "AI Matchmaker",
  slug: "ai-matchmaker",
  scheme: "aimatchmaker",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/icon.png",
  primaryColor: "#0f766e",
  // Matches the deployed API. Builds read it from the EAS profile; `npm start` falls back
  // to the loopback address the api container publishes.
  extra: {
    apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:8000",
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID },
  },
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
      backgroundColor: "#faf7f1",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      "android.permission.CAMERA",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.READ_MEDIA_IMAGES",
    ],
    // We never ask for precise location: matching works on coarse zones, and asking for
    // more than we use is both a Play Data safety liability and a trust cost.
    blockedPermissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.RECORD_AUDIO",
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        photosPermission:
          "AI Matchmaker needs your photo library so you can choose the photos that appear on your profile.",
        cameraPermission:
          "AI Matchmaker uses the camera so you can take a profile photo and complete identity verification.",
      },
    ],
    [
      "expo-notifications",
      {
        color: "#0f766e",
        defaultChannel: "introductions",
      },
    ],
  ],
});
