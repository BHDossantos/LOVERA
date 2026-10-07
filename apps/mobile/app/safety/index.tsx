import { useState } from "react";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { ApiError, del, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { CATEGORY_LABEL, telUri, type Block, type SafetyCase, type SafetyCenter } from "@/components/safety";
import { Badge, Button, Card, Divider, Empty, ErrorState, Loading, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * S01 Safety centre. Reachable from every screen, and never more than one tap from a report.
 *
 * Three requests, because the API splits them that way: /safety carries the emergency
 * number, the guidance and two counts; the case list is /safety/cases and the block list is
 * /blocks. The previous version read all of it off /safety, which does not return it.
 */
export default function SafetyCentre() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const router = useRouter();
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const [unblockError, setUnblockError] = useState<ApiError | null>(null);

  const centre = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetyCenter>("/safety"), enabled: !!me });
  const cases = useQuery({
    queryKey: ["safety", "cases"],
    queryFn: () => get<{ items: SafetyCase[] }>("/safety/cases"),
    enabled: !!me,
  });
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => get<{ items: Block[] }>("/blocks"), enabled: !!me });

  const emergency = centre.data?.emergency;
  const unblock = (b: Block) =>
    Alert.alert(
      `Unblock ${b.display_name}?`,
      "They are never told you blocked them, or that you stopped. A conversation that ended stays ended.",
      [
        { text: "Keep blocked", style: "cancel" },
        {
          text: "Unblock",
          onPress: () => {
            setUnblocking(b.member_id);
            setUnblockError(null);
            // An offline device used to leave this as an unhandled rejection: the block
            // stayed, nothing was said, and the member had no way to tell it had failed.
            void del(`/blocks/${b.member_id}`)
              .then(() => Promise.all([blocks.refetch(), centre.refetch()]))
              .catch((e) => setUnblockError(e as ApiError))
              .finally(() => setUnblocking(null));
          },
        },
      ],
    );

  return (
    <Screen>
      <PageTitle
        eyebrow="Safety"
        title="Safety centre"
        lede="Report someone, block them, or check a case. Nothing you report is shown to the person you report."
      />
      <ErrorState error={unblockError ?? ((centre.error as ApiError) ?? null)} retry={() => centre.refetch()} />

      {/* The emergency number comes first and does not depend on anything else loading. */}
      <StatusBanner
        tone="caution"
        title="In immediate danger, call emergency services"
        body={emergency?.note ?? "We are not an emergency service."}
      />
      <Button
        variant="danger"
        onPress={() => void Linking.openURL(telUri(emergency))}
      >
        {`Call ${emergency?.number ?? "112"}`}
      </Button>

      <Button onPress={() => router.push("/safety/report" as never)}>Report someone</Button>

      {centre.isLoading && <Loading label="Loading safety options" />}

      {!!centre.data?.education.length && (
        <Card>
          <Text style={s.section}>Worth knowing</Text>
          {centre.data.education.map((e) => (
            <Text key={e} style={s.edu}>
              • {e}
            </Text>
          ))}
        </Card>
      )}

      <Divider />
      <Text style={s.section}>Your cases</Text>
      {cases.isLoading && <Loading label="Loading your cases" />}
      <ErrorState error={(cases.error as ApiError) ?? null} retry={() => cases.refetch()} />
      {cases.data?.items.length === 0 && (
        <Empty title="No cases" body="Anything you report shows up here with its status." />
      )}
      {cases.data?.items.map((c) => (
        <Pressable key={c.id} onPress={() => router.push(`/safety/cases/${c.id}` as never)} accessibilityRole="button">
          <Card>
            <View style={s.row}>
              <Text style={s.name}>{CATEGORY_LABEL[c.category]?.label ?? c.category}</Text>
              <Badge label={c.state} tone="muted" />
            </View>
            <Text style={s.meta}>Opened {new Date(c.opened_at).toLocaleDateString()}</Text>
          </Card>
        </Pressable>
      ))}

      <Divider />
      <Text style={s.section}>People you've blocked</Text>
      {blocks.isLoading && <Loading label="Loading your blocks" />}
      <ErrorState error={(blocks.error as ApiError) ?? null} retry={() => blocks.refetch()} />
      {blocks.data?.items.length === 0 && (
        <Empty title="Nobody blocked" body="Blocking is immediate and silent. They are never told." />
      )}
      {blocks.data?.items.map((b) => (
        <Card key={b.member_id}>
          <Text style={s.name}>{b.display_name}</Text>
          <Text style={s.meta}>Blocked {new Date(b.created_at).toLocaleDateString()}</Text>
          {/* A block you cannot lift is a decision made for you. */}
          <Button variant="ghost" loading={unblocking === b.member_id} onPress={() => unblock(b)}>
            Unblock
          </Button>
        </Card>
      ))}
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  section: { ...typo.title, color: color.ink, marginTop: space.lg, marginBottom: space.sm },
  edu: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
} as const;
