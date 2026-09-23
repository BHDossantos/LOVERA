import { Stack } from "expo-router";
import { color } from "@/theme";

export default function OnboardingLayout() {
  // Onboarding is a forward-only sequence driven by the server's onboarding_step; the
  // native back gesture would let a member skip past a step the server still expects.
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: color.canvas } }} />
  );
}
