import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useRequireMember } from "@/lib/auth";
import { color } from "@/theme";

/**
 * Five destinations, matching the web's navigation. No badge on anything except
 * Messages: this product's whole argument is that it should not compete for attention,
 * and a red dot on "Today" would be exactly the nagging we tell members we don't do.
 */
function Icon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }} accessibilityElementsHidden importantForAccessibility="no">
      {glyph}
    </Text>
  );
}

export default function AppLayout() {
  useRequireMember();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.action,
        tabBarInactiveTintColor: color.inkTertiary,
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: color.canvas },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{ title: "Today", tabBarIcon: ({ focused }) => <Icon glyph="◎" focused={focused} /> }}
      />
      <Tabs.Screen
        name="introductions"
        options={{ title: "Introductions", tabBarIcon: ({ focused }) => <Icon glyph="✦" focused={focused} /> }}
      />
      <Tabs.Screen
        name="messages"
        options={{ title: "Messages", tabBarIcon: ({ focused }) => <Icon glyph="✉" focused={focused} /> }}
      />
      <Tabs.Screen
        name="dates"
        options={{ title: "Dates", tabBarIcon: ({ focused }) => <Icon glyph="◈" focused={focused} /> }}
      />
      <Tabs.Screen
        name="you"
        options={{ title: "You", tabBarIcon: ({ focused }) => <Icon glyph="☺" focused={focused} /> }}
      />
    </Tabs>
  );
}
