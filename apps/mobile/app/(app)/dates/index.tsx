import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { DatePlan } from "@/api/types";
import { Badge, Card, Empty, ErrorState, Loading, PageTitle, Screen } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

const STATUS_TONE: Record<string, "success" | "context" | "caution" | "muted"> = {
  confirmed: "success",
  proposed: "context",
  cancelled: "caution",
  completed: "muted",
};

/** D01 Dates: public venues, coarse windows, and the safety check-in attached to each. */
export default function DatesScreen() {
  const { me } = useRequireMember();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["date-plans"],
    queryFn: () => get<{ items: DatePlan[] }>("/date-plans"),
    enabled: !!me,
  });

  return (
    <Screen>
      <PageTitle
        eyebrow="Dates"
        title="Where you're meeting"
        lede="Public places, agreed times, and a check-in you control. A first date is a plan, not a leap."
      />
      {q.isLoading && <Loading label="Loading dates" />}
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      {!!q.data && q.data.items.length === 0 && (
        <Empty
          title="No dates planned"
          body="Open a conversation and tap Plan a date. You'll only see windows you both marked free, and only public places."
        />
      )}
      {q.data?.items.map((d) => (
        <Pressable key={d.id} onPress={() => router.push(`/dates/${d.id}` as never)} accessibilityRole="button">
          <Card>
            <View style={s.row}>
              <Text style={s.name}>{d.other_display_name}</Text>
              <Badge label={d.status} tone={STATUS_TONE[d.status] ?? "muted"} />
            </View>
            {!!d.venue && (
              <Text style={s.meta}>
                {d.venue.name} · {d.venue.coarse_area}
              </Text>
            )}
            {!!d.starts_at && <Text style={s.meta}>{new Date(d.starts_at).toLocaleString()}</Text>}
            {d.awaiting_your_confirmation && <Text style={s.action}>Waiting on your confirmation</Text>}
            {!!d.check_in && <Text style={s.checkin}>Check-in set · {d.check_in.share_scope}</Text>}
            {d.feedback_open && !d.feedback_submitted && <Text style={s.action}>Private feedback is open</Text>}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  action: { ...typo.caption, color: color.context, marginTop: space.sm },
  checkin: { ...typo.caption, color: color.success, marginTop: space.xs },
} as const;
