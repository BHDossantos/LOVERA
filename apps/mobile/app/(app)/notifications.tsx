import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { Notification } from "@/api/types";
import { Badge, Button, Card, Empty, ErrorState, Loading, PageTitle, Screen } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * The inbox behind the push notifications.
 *
 * The app has registered push tokens since the mobile build shipped, so members could be
 * notified about an introduction and then find nowhere in the app to see it again — a
 * notification dismissed from the lock screen was simply gone. Opening this screen marks
 * everything read, which is the behaviour a member expects and the API supports with an
 * empty `ids`.
 */
type Out = { items: Notification[]; unread: number };

export default function Notifications() {
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["notifications"], queryFn: () => get<Out>("/notifications"), enabled: !!me });

  // Mark read once, after the list has actually been seen.
  const unread = q.data?.unread ?? 0;
  useEffect(() => {
    if (!unread) return;
    void post("/notifications/read", {})
      .then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))
      .catch(() => {
        // A failed mark-read is not worth interrupting someone's reading for.
      });
  }, [unread, qc]);

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading your notifications" />
      </Screen>
    );

  return (
    <Screen>
      <PageTitle
        eyebrow="Notifications"
        title="What's happened"
        lede="Introductions, replies and anything safety-related. Nothing here is marketing."
      />
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />

      {q.data?.items.length === 0 && (
        <Empty title="Nothing yet" body="When an introduction arrives or someone replies, it shows up here." />
      )}

      {q.data?.items.map((n) => (
        <Pressable
          key={n.id}
          accessibilityRole={n.deep_link ? "link" : "text"}
          disabled={!n.deep_link}
          onPress={() => n.deep_link && router.push(n.deep_link as never)}
        >
          <Card>
            <View style={s.row}>
              <Text style={s.title}>{n.title}</Text>
              {!n.read_at && <Badge label="New" tone="success" />}
            </View>
            <Text style={s.body}>{n.body}</Text>
            <Text style={s.meta}>
              {n.group} · {new Date(n.created_at).toLocaleString()}
            </Text>
          </Card>
        </Pressable>
      ))}

      <Button variant="ghost" onPress={() => router.back()}>
        Done
      </Button>
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  body: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  meta: { ...typo.small, color: color.inkTertiary, marginTop: space.xs },
} as const;
