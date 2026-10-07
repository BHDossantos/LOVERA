import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { serverDriven, useAwaitingServer } from "@/lib/query";
import type { ConversationSummary } from "@/api/types";
import { Badge, Card, Empty, ErrorState, Loading, PageTitle, Screen } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/** M01 Conversations: only people who both said yes. No inbox of strangers. */
export default function MessagesScreen() {
  const { me } = useRequireMember();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["conversations"],
    ...serverDriven,
    queryFn: () => get<{ items: ConversationSummary[] }>("/conversations"),
    enabled: !!me,
    refetchInterval: 30_000,
  });
  /**
   * Null while the screen is still waiting on the server, so nothing stale renders.
   *
   * `awaitingServer` as an extra spinner was not enough: `gcTime: 0` cannot evict a query that
   * another mounted screen still observes, so the previous answer stayed on screen — and
   * actionable — underneath the loading indicator.
   */
  const awaiting = useAwaitingServer(q);
  const data = awaiting ? null : q.data;

  return (
    <Screen>
      <PageTitle
        eyebrow="Messages"
        title="Conversations"
        lede="Only with people who also said yes. There is no inbox of strangers here."
      />
      {awaiting && !q.isError && <Loading label="Loading conversations" />}
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      {!!data && data.items.length === 0 && (
        <Empty title="No conversations yet" body="A conversation opens the moment an introduction is mutual." />
      )}
      {data?.items.map((c) => (
        <Pressable key={c.id} onPress={() => router.push(`/messages/${c.id}` as never)} accessibilityRole="button">
          <Card>
            <View style={s.row}>
              <Text style={s.name}>{c.other.display_name}</Text>
              {c.unread > 0 && <Badge label={`${c.unread} new`} tone="context" />}
            </View>
            {c.safety_hold && <Text style={s.hold}>Paused during a safety review</Text>}
            {!!c.last_message && (
              <Text style={s.preview} numberOfLines={2}>
                {c.last_message.mine ? "You: " : ""}
                {c.last_message.text}
              </Text>
            )}
            {!c.last_message && <Text style={s.preview}>Say hello when you're ready.</Text>}
            {!!c.date && (
              <Text style={s.date}>
                Date {c.date.status}
                {c.date.starts_at ? ` · ${new Date(c.date.starts_at).toLocaleString()}` : ""}
              </Text>
            )}
            {!!c.public_reason && <Text style={s.ended}>{c.public_reason}</Text>}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  preview: { ...typo.small, color: color.inkSecondary, marginTop: space.xs },
  date: { ...typo.caption, color: color.action, marginTop: space.sm },
  hold: { ...typo.caption, color: color.caution, marginTop: space.xs },
  ended: { ...typo.caption, color: color.inkTertiary, marginTop: space.xs },
} as const;
