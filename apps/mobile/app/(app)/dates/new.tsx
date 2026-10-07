import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { DatePlan } from "@/api/types";
import { Button, Card, ChoiceCard, Empty, ErrorState, Loading, Options, PageTitle, Screen, StatusBanner, Toggle } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * D01 Date planner, step one: when.
 *
 * Only windows where both people already said they are free are shown, and only the one
 * window chosen here is ever sent — the rest of either person's availability stays private.
 * That is why the consent line is explicit rather than implied: picking a window is the
 * moment a piece of your calendar becomes visible to someone else.
 *
 * Nothing is sent from this screen. The proposal is made on the venue step, in one request.
 */
type Overlap = { date: string; weekday: string; start: string; end: string; starts_at: string; ends_at: string };
type OverlapsOut = { items: Overlap[]; concierge: boolean; note: string };

export default function DatePlanner() {
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const { conversation, plan: planParam } = useLocalSearchParams<{ conversation?: string; plan?: string }>();

  const [plan, setPlan] = useState<DatePlan | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [chosen, setChosen] = useState<Overlap | null>(null);
  const [startAt, setStartAt] = useState("");
  const [consent, setConsent] = useState(false);

  // Get-or-create the plan for this conversation — the API is idempotent per conversation —
  // or load one we were handed.
  useEffect(() => {
    if (!me?.id) return;
    let alive = true;
    setError(null);
    const load = planParam
      ? get<DatePlan>(`/date-plans/${planParam}`)
      : conversation
        ? post<DatePlan>("/date-plans", { conversation_id: conversation })
        : Promise.reject(new ApiError(400, { code: "VALIDATION_ERROR", message: "Open the planner from a conversation." }));
    load
      .then((p) => {
        if (!alive) return;
        setPlan(p);
        qc.setQueryData(["date-plan", p.id], p);
      })
      .catch((e) => alive && setError(e as ApiError));
    return () => {
      alive = false;
    };
  }, [me?.id, conversation, planParam, qc]);

  const overlaps = useQuery({
    queryKey: ["date-plan", plan?.id, "overlaps"],
    queryFn: () => get<OverlapsOut>(`/date-plans/${plan?.id}/overlaps`),
    enabled: !!plan,
  });

  // Half-hour starts inside the chosen window, leaving at least an hour before it closes.
  const slots = useMemo(() => {
    if (!chosen) return [] as string[];
    const start = new Date(chosen.starts_at).getTime();
    const end = new Date(chosen.ends_at).getTime();
    const out: string[] = [];
    for (let t = start; t + 60 * 60_000 <= end; t += 30 * 60_000) out.push(new Date(t).toISOString());
    return out;
  }, [chosen]);
  useEffect(() => setStartAt(slots[0] ?? ""), [slots]);

  const closed = !!plan && ["cancelled", "completed", "no_show", "disputed"].includes(plan.status);

  if (!plan && !error)
    return (
      <Screen scroll={false}>
        <Loading label="Preparing your plan" />
      </Screen>
    );

  return (
    <Screen>
      <PageTitle
        eyebrow="Plan a date"
        title={plan ? `When could you and ${plan.other_display_name} meet?` : "When could you meet?"}
        lede="Only windows you both marked free are shown. Nobody sees the other person's full availability."
      />
      <ErrorState error={error} retry={() => router.back()} />

      {closed && <StatusBanner tone="caution" title="This plan is closed. Start a new one from the conversation." />}

      {!!plan && !closed && (
        <>
          {plan.status !== "draft" && !!plan.starts_at && (
            <StatusBanner
              tone="context"
              title="There is already a proposal on the table"
              body={`Choosing a new window sends a change that ${plan.other_display_name} has to reconfirm.`}
            />
          )}

          <Card>
            <Text style={s.h2}>Overlapping windows</Text>
            <Text style={s.meta}>{overlaps.data?.note ?? "Only overlapping windows are shown."}</Text>
            {overlaps.isLoading && <Loading label="Finding overlapping windows" />}
            {!!overlaps.error && <ErrorState error={overlaps.error as ApiError} retry={() => overlaps.refetch()} />}
            {overlaps.data?.items.length === 0 && (
              <Empty
                title="No overlapping window yet"
                body="Your availability and theirs don't line up in the next two weeks. Adding a window on your side is the fastest fix — the other person is never told what you changed."
              />
            )}
            {overlaps.data?.items.map((w) => (
              <ChoiceCard
                key={w.starts_at}
                title={`${w.weekday} ${w.date}`}
                body={`${w.start}–${w.end} (${plan.timezone})`}
                selected={chosen?.starts_at === w.starts_at}
                onSelect={() => setChosen(w)}
              />
            ))}
            {overlaps.data?.items.length === 0 && (
              <Button variant="secondary" onPress={() => router.push("/onboarding/availability" as never)}>
                Update my availability
              </Button>
            )}
          </Card>

          {!!chosen && (
            <Card>
              <Text style={s.h2}>Start time</Text>
              <Text style={s.meta}>Dates are two hours by default; you can change that on the next step.</Text>
              <Options
                value={startAt}
                options={slots.map((v) => ({ value: v, label: new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }))}
                onChange={setStartAt}
              />
              <Toggle
                value={consent}
                onValueChange={setConsent}
                label={`${plan.other_display_name} will see this one window as my suggestion. My other free times stay private.`}
              />
            </Card>
          )}

          <Button
            disabled={!chosen || !startAt || !consent}
            onPress={() =>
              router.push({ pathname: "/dates/venues", params: { plan: plan.id, starts_at: startAt } } as never)
            }
          >
            {chosen && startAt ? "Choose a venue" : "Choose a window first"}
          </Button>
        </>
      )}
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
} as const;
