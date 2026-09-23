import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { TodayTask } from "@/api/types";
import { Badge, Button, Card, Empty, ErrorState, Loading, PageTitle, Screen } from "@/components/ui";
import { color, space, type as typo } from "@/theme";
import { ApiError } from "@/api/client";

type Today = {
  next_action: TodayTask;
  tasks: TodayTask[];
  readiness: {
    date_ready: boolean;
    verification: string;
    blueprint_fresh: boolean;
    plan: string;
    trial_introductions_remaining: number;
  };
  introduction_timing: { cadence: string; cap: number };
  unread_notifications: number;
  safety_shortcut: string;
};

const VERIFICATION_LABEL: Record<string, string> = {
  verified: "Verified",
  pending: "Under review",
  pending_review: "Under review",
  not_started: "Not started",
  failed: "Needs attention",
  expired: "Expired",
};

/** T01 Today: one next best action ranked by member outcome, never a feed. */
export default function TodayScreen() {
  const { me } = useRequireMember();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["today"],
    queryFn: () => get<Today>("/today"),
    enabled: !!me,
    refetchInterval: 60_000,
  });

  return (
    <Screen>
      <PageTitle
        eyebrow="Today"
        title="What should I do now?"
        lede="One task at a time, ranked by what moves you toward a real date. Less time in the app is fine."
      />
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      {q.isLoading && <Loading label="Loading today" />}
      {!!q.data && (
        <>
          <Card style={{ borderColor: color.action, borderWidth: 2 }}>
            <Text style={s.eyebrow}>NEXT</Text>
            <Text style={s.taskTitle}>{q.data.next_action.title}</Text>
            <Text style={s.taskBody}>{q.data.next_action.body}</Text>
            <Button onPress={() => router.push(q.data.next_action.path as never)}>
              {q.data.next_action.cta}
            </Button>
          </Card>

          {q.data.tasks.length > 1 && (
            <>
              <Text style={s.section}>Also waiting</Text>
              {q.data.tasks
                .filter((t) => t.key !== q.data.next_action.key)
                .map((t) => (
                  <Pressable key={t.key} onPress={() => router.push(t.path as never)} accessibilityRole="button">
                    <Card>
                      <Text style={s.taskTitleSmall}>{t.title}</Text>
                      <Text style={s.taskBody}>{t.body}</Text>
                      <Text style={s.cta}>{t.cta} →</Text>
                    </Card>
                  </Pressable>
                ))}
            </>
          )}

          {q.data.tasks.length === 0 && (
            <Empty
              title="Nothing needs you right now"
              body={`Introductions arrive ${q.data.introduction_timing.cadence}. We'll let you know.`}
            />
          )}

          <Text style={s.section}>Where you stand</Text>
          <Card>
            <View style={s.row}>
              <Text style={s.rowLabel}>Identity</Text>
              <Badge
                label={VERIFICATION_LABEL[q.data.readiness.verification] ?? q.data.readiness.verification}
                tone={q.data.readiness.verification === "verified" ? "success" : "context"}
              />
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Open to introductions</Text>
              <Badge
                label={q.data.readiness.date_ready ? "Yes" : "Paused"}
                tone={q.data.readiness.date_ready ? "success" : "muted"}
              />
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Blueprint</Text>
              <Badge
                label={q.data.readiness.blueprint_fresh ? "Current" : "Worth refreshing"}
                tone={q.data.readiness.blueprint_fresh ? "success" : "context"}
              />
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Plan</Text>
              <Badge label={q.data.readiness.plan} tone="muted" />
            </View>
          </Card>

          <Button variant="ghost" onPress={() => router.push(q.data.safety_shortcut as never)}>
            Safety centre
          </Button>
        </>
      )}
    </Screen>
  );
}

const s = {
  eyebrow: { ...typo.caption, color: color.action, letterSpacing: 0.8, marginBottom: space.xs },
  taskTitle: { ...typo.title, color: color.ink, marginBottom: space.xs },
  taskTitleSmall: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  taskBody: { ...typo.small, color: color.inkSecondary, marginBottom: space.md },
  cta: { ...typo.small, color: color.action, fontWeight: "700" },
  section: { ...typo.title, color: color.ink, marginTop: space.lg, marginBottom: space.sm },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.sm,
  },
  rowLabel: { ...typo.body, color: color.inkSecondary },
} as const;
