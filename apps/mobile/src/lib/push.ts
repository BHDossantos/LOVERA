import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { api } from "@/api/client";

/**
 * Push registration.
 *
 * This is the retention loop, not a nicety: an introduction that arrives on Wednesday
 * afternoon and a reply to a message are both worthless if nobody is told. Everything
 * else in this product argues for less time in the app, which only works if the few
 * things that matter actually reach the member.
 *
 * We ask for the permission after sign-in rather than at launch. On iOS a denial is
 * effectively permanent — the prompt never returns — so spending it on a cold start,
 * before the member has any reason to want to hear from us, is spending it badly.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // shouldShowAlert is deprecated in SDK 57; banner and list are the current pair.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

export async function ensureAndroidChannels() {
  if (Platform.OS !== "android") return;
  // Separate channels so a member can silence date logistics without silencing a
  // safety message, which Android lets them do per channel.
  await Notifications.setNotificationChannelAsync("introductions", {
    name: "Introductions",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#b42d55",
  });
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Messages",
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: "#b42d55",
  });
  await Notifications.setNotificationChannelAsync("safety", {
    name: "Safety",
    importance: Notifications.AndroidImportance.MAX,
    lightColor: "#b3301c",
  });
}

export type PushOutcome = "registered" | "denied" | "unsupported" | "misconfigured" | "error";

export async function registerForPush(deviceId?: string): Promise<PushOutcome> {
  // A simulator has no push transport at all; asking there produces a confusing
  // permission dialog followed by a failure that means nothing.
  if (!Device.isDevice) return "unsupported";
  try {
    await ensureAndroidChannels();
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== "granted") return "denied";

    // Expo mints the token against an EAS project. A standalone build with no project id
    // cannot get one, and the failure looks exactly like "the member declined" unless we
    // say so: push would simply never arrive, for everybody, with nothing in the UI to
    // show it. EXPO_PUBLIC_EAS_PROJECT_ID comes from `eas init` — see docs/STORE-SUBMISSION.md.
    const id = projectId();
    if (!id && Constants.appOwnership !== "expo") {
      console.warn(
        "[push] no EAS project id, so no push token can be issued; " +
          "set EXPO_PUBLIC_EAS_PROJECT_ID for this build",
      );
      return "misconfigured";
    }
    const token = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
    await api("/notifications/devices", {
      method: "PUT",
      body: {
        token: token.data,
        platform: Platform.OS === "ios" ? "ios" : "android",
        device_id: deviceId,
        app_version: Constants.expoConfig?.version,
      },
    });
    return "registered";
  } catch (err) {
    // Never surface this to the member: someone who cannot receive push should still be
    // able to use every part of the app, and there is nothing useful for them to do about
    // it. Do log it, though — a silently swallowed failure here means push is dead for
    // everyone and nobody finds out until a member misses an introduction.
    console.warn("[push] registration failed", err);
    return "error";
  }
}

export async function unregisterPush(deviceId?: string) {
  try {
    await api("/notifications/devices/revoke", { method: "POST", body: { device_id: deviceId } });
  } catch {
    /* signing out matters more than tidying up the token */
  }
}
