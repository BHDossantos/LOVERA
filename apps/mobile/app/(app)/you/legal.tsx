import { Linking, Text } from "react-native";
import Constants from "expo-constants";
import { Button, Card, PageTitle, Screen } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

const origin = ((Constants.expoConfig?.extra as { apiOrigin?: string } | undefined)?.apiOrigin ?? "").replace(/\/$/, "");

const DOCS = [
  { path: "/legal/terms", label: "Terms of Service", body: "What we promise, what we ask, and how billing works." },
  { path: "/legal/privacy", label: "Privacy Notice", body: "What we collect, what we never collect, and how to get it all back." },
  { path: "/legal/community", label: "Community Agreement", body: "The behaviour everyone here agrees to." },
];

/** Reachable without signing in is a store requirement; reachable in two taps is just decent. */
export default function Legal() {
  return (
    <Screen>
      <PageTitle eyebrow="Legal" title="The agreements you accepted" />
      {DOCS.map((d) => (
        <Card key={d.path}>
          <Text style={s.h2}>{d.label}</Text>
          <Text style={s.meta}>{d.body}</Text>
          <Button variant="secondary" onPress={() => void Linking.openURL(`${origin}${d.path}`)}>
            Read it
          </Button>
        </Card>
      ))}
      <Text style={s.fine}>Version v2026-09. We tell you in the app before any version changes what we do with your data.</Text>
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginBottom: space.md },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.md },
} as const;
