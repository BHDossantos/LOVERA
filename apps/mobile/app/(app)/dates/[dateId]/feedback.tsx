import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { serverDriven, useAwaitingServer } from "@/lib/query";
import type { DatePlan } from "@/api/types";
import { AwaitingServer, Button, Card, ChoiceCard, ErrorState, Options, PageTitle, Screen, StatusBanner, Toggle } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * D05 Private post-date feedback.
 *
 * Attendance comes first and is not optional. It is what decides whether the plan becomes
 * `completed` or `no_show`, and a mismatch between the two people's answers is how an
 * attendance dispute reaches a human — so it cannot be inferred from a second-date answer.
 * The previous version of this screen sent `{second_date: true}` and was rejected by the
 * API for a missing `attendance` every time.
 *
 * No star ratings, and a second-date yes is revealed only when both say yes. A safety
 * concern is a separate route to a human, never a rating.
 */
const ATTENDANCE = [
  { value: "attended", title: "We met", body: "The date happened." },
  { value: "other_no_show", title: "They didn't come", body: "You were there and they were not." },
  { value: "i_cancelled", title: "I couldn't make it", body: "You cancelled or did not go." },
  { value: "not_yet", title: "It hasn't happened yet", body: "Come back afterwards." },
];

export default function DateFeedback() {
  const { me } = useRequireMember();
  const { dateId } = useLocalSearchParams<{ dateId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [attendance, setAttendance] = useState("attended");
  const [feltSafe, setFeltSafe] = useState<boolean | null>(null);
  const [enjoyed, setEnjoyed] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const [safetyFlag, setSafetyFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const q = useQuery({
    queryKey: ["date-plan", dateId],
    ...serverDriven,
    queryFn: () => get<DatePlan>(`/date-plans/${dateId}`),
    enabled: !!me && !!dateId,
  });

  const met = attendance === "attended";
  const canSubmit = attendance !== "not_yet" && (!met || second !== null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/date-plans/${dateId}/feedback`, {
        attendance,
        felt_safe: met ? feltSafe : null,
        enjoyed: met ? enjoyed : null,
        second_date_answer: met ? second : null,
        fit_reasons: [],
        safety_flag: safetyFlag,
        learning_consent: false,
      });
      await Promise.all([
        q.refetch(),
        qc.invalidateQueries({ queryKey: ["date-plans"] }),
        // Removed, not invalidated: invalidate marks an entry stale and leaves it in place, so
        // the screen this navigates to would still have something to paint. The old answer is
        // "no mutual result yet", which is the one thing it must not say here.
        qc.removeQueries({ queryKey: ["date-plan", dateId, "outcome"] }),
      ]);
      router.replace(`/dates/${dateId}/mutual-second-date` as never);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const awaiting = useAwaitingServer(q);
  if (awaiting)
    return (
      <Screen scroll={false}>
        <AwaitingServer label="Loading date" query={q} />
      </Screen>
    );

  const d = q.data;
  return (
    <Screen>
      <PageTitle
        eyebrow="Private feedback"
        title={d ? `How was meeting ${d.other_display_name}?` : "How did it go?"}
        lede="Private. No star ratings, and no reasons are ever shown to anyone. A second-date yes is revealed only if you both say yes."
      />
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />
      {!!d && !d.feedback_open && !d.feedback_submitted && (
        <StatusBanner tone="context" title="Feedback opens once the date has started." />
      )}
      {!!d?.feedback_submitted && (
        <StatusBanner tone="context" title="You have answered before. Saving again replaces those answers." />
      )}

      <Card>
        <Text style={s.h2}>Did the date happen?</Text>
        {ATTENDANCE.map((a) => (
          <ChoiceCard
            key={a.value}
            title={a.title}
            body={a.body}
            selected={attendance === a.value}
            onSelect={() => setAttendance(a.value)}
          />
        ))}
      </Card>

      {met && (
        <>
          <Card>
            <Text style={s.h2}>Did you feel safe?</Text>
            <Options
              value={feltSafe === null ? "" : feltSafe ? "yes" : "no"}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              onChange={(v) => setFeltSafe(v === "yes")}
            />
          </Card>
          <Card>
            <Text style={s.h2}>Did you enjoy it?</Text>
            <Options
              value={enjoyed ?? ""}
              options={[
                { value: "yes", label: "Yes" },
                { value: "somewhat", label: "Somewhat" },
                { value: "no", label: "No" },
              ]}
              onChange={(v) => setEnjoyed(v)}
            />
          </Card>
          <Card>
            <Text style={s.h2}>Would you like a second date?</Text>
            <Text style={s.meta}>
              {d?.other_display_name} sees nothing unless you both say yes. "Unsure" is a fine answer.
            </Text>
            <Options
              value={second ?? ""}
              options={[
                { value: "yes", label: "Yes" },
                { value: "unsure", label: "Unsure" },
                { value: "no", label: "No" },
              ]}
              onChange={(v) => setSecond(v)}
            />
          </Card>
        </>
      )}

      <Card>
        <Text style={s.h2}>Anything we should know?</Text>
        <Text style={s.meta}>
          A safety concern goes to a human team, never into matching. Flagging it here is not a report — you can
          report or block separately, whenever you are ready.
        </Text>
        <Toggle value={safetyFlag} onValueChange={setSafetyFlag} label="Flag a safety concern for review" />
        <Button variant="secondary" onPress={() => router.push(`/safety/report?date=${dateId}` as never)}>
          Report something
        </Button>
      </Card>

      <Button disabled={!canSubmit} loading={busy} onPress={submit}>
        {attendance === "not_yet"
          ? "Come back after the date"
          : met && second === null
            ? "Answer the second-date question first"
            : "Save my private answers"}
      </Button>
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
} as const;
