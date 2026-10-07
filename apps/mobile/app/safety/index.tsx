import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Linking, Pressable, Text, View } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { CATEGORY_LABEL, type SafetyCenter } from "@/components/safety";
import { Badge, Button, Card, Empty, ErrorState, Loading, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/** S01 Safety centre. Reachable from every screen, and never more than one tap from a report. */
export default function SafetyCentre() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const router = useRouter();
  const q = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetyCenter>("/safety"), enabled: !!me });

  return (
    <Screen>
      <PageTitle
        eyebrow="Safety"
        title="Safety centre"
        lede="Report someone, block them, or check a case. Nothing you report is shown to the person you report."
      />
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      <StatusBanner
        tone="caution"
        title="If you are in immediate danger"
        body={`Call your local emergency number${q.data?.emergency ? ` (${q.data.emergency})` : ""}. We are not an emergency service.`}
      />
      {!!q.data?.emergency && (
        <Button variant="danger" onPress={() => void Linking.openURL(`tel:${q.data.emergency}`)}>
          {`Call ${q.data.emergency}`}
        </Button>
      )}

      <Button onPress={() => router.push("/safety/report" as never)}>Report someone</Button>

      {q.isLoading && <Loading label="Loading safety centre" />}

      {!!q.data && (
        <>
          <Text style={s.section}>Your cases</Text>
          {q.data.cases.length === 0 && <Empty title="No open cases" body="Anything you report shows up here with its status." />}
          {q.data.cases.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/safety/cases/${c.id}` as never)} accessibilityRole="button">
              <Card>
                <View style={s.row}>
                  <Text style={s.name}>{CATEGORY_LABEL[c.category]?.label ?? c.category}</Text>
                  <Badge label={c.state} tone="context" />
                </View>
                <Text style={s.meta}>Opened {new Date(c.opened_at).toLocaleDateString()}</Text>
              </Card>
            </Pressable>
          ))}

          <Text style={s.section}>People you've blocked</Text>
          {q.data.blocks.length === 0 && <Empty title="Nobody blocked" body="Blocking is immediate and silent. They are never told." />}
          {q.data.blocks.map((b) => (
            <Card key={b.id}>
              <Text style={s.name}>{b.display_name}</Text>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  section: { ...typo.title, color: color.ink, marginTop: space.lg, marginBottom: space.sm },
} as const;
