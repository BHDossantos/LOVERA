import { Tabs } from "expo-router";
import { useRequireMember } from "@/lib/auth";
import { TabIcon } from "@/components/TabIcon";
import { color } from "@/theme";

/**
 * Five destinations, matching the web's navigation. No badge on anything except
 * Messages: this product's whole argument is that it should not compete for attention,
 * and a red dot on "Today" would be exactly the nagging we tell members we don't do.
 */
export default function AppLayout() {
  useRequireMember();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.action,
        tabBarInactiveTintColor: color.inkTertiary,
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        sceneStyle: { backgroundColor: color.canvas },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{ title: "Today", tabBarIcon: ({ color: c }) => <TabIcon name="today" color={c} /> }}
      />
      <Tabs.Screen
        name="introductions"
        options={{ title: "Introductions", tabBarIcon: ({ color: c }) => <TabIcon name="introductions" color={c} /> }}
      />
      <Tabs.Screen
        name="messages"
        options={{ title: "Messages", tabBarIcon: ({ color: c }) => <TabIcon name="messages" color={c} /> }}
      />
      <Tabs.Screen
        name="dates"
        options={{ title: "Dates", tabBarIcon: ({ color: c }) => <TabIcon name="dates" color={c} /> }}
      />
      <Tabs.Screen
        name="you"
        options={{ title: "You", tabBarIcon: ({ color: c }) => <TabIcon name="you" color={c} /> }}
      />
    </Tabs>
  );
}
