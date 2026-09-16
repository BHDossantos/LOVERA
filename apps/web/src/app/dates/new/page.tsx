"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, EmptyState, ErrorState, LinkButton, PageTitle, Select, Skeleton, StatusBanner } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { shortWhen, type Overlap, type OverlapsOut } from "@/components/dates/shared";
import type { DatePlan } from "@/lib/types";

/** D01 Date planner: only overlapping windows, explicit consent step, then venues. Manual planning stays free. */
function PlannerInner() {
  const { me } = useRequireMember();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const conversationId = params.get("conversation");
  const planParam = params.get("plan");
  const [plan, setPlan] = useState<DatePlan | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [chosen, setChosen] = useState<Overlap | null>(null);
  const [startAt, setStartAt] = useState<string>("");
  const [consent, setConsent] = useState(false);

  // Get-or-create the plan for this conversation (idempotent on the API side), or load an existing plan.
  useEffect(() => {
    if (!me) return;
    let alive = true;
    setError(null);
    const load = planParam ? get<DatePlan>(`/date-plans/${planParam}`) : conversationId ? post<DatePlan>("/date-plans", { conversation_id: conversationId }) : Promise.reject(new ApiError(400, { code: "VALIDATION_ERROR", message: "Open this planner from a conversation." }));
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
  }, [me, conversationId, planParam, qc]);

  const overlaps = useQuery({ queryKey: ["date-plan", plan?.id, "overlaps"], queryFn: () => get<OverlapsOut>(`/date-plans/${plan?.id}/overlaps`), enabled: !!plan });
  const concierge = me?.capabilities.entitlements.date_concierge ?? false;

  // Start-time slots inside the chosen window (30-minute steps, leaving at least 60 minutes).
  const slots = useMemo(() => {
    if (!chosen) return [] as string[];
    const start = new Date(chosen.starts_at).getTime();
    const end = new Date(chosen.ends_at).getTime();
    const out: string[] = [];
    for (let t = start; t + 60 * 60_000 <= end; t += 30 * 60_000) out.push(new Date(t).toISOString());
    return out;
  }, [chosen]);
  useEffect(() => {
    setStartAt(slots[0] ?? "");
  }, [slots]);

  const closed = plan && ["cancelled", "completed", "no_show", "disputed"].includes(plan.status);

  const goToVenues = () => {
    if (!plan || !startAt) return;
    const qs = new URLSearchParams({ plan: plan.id, starts_at: startAt });
    router.push(`/dates/new/venues?${qs.toString()}`);
  };

  return (
    <AppShell>
      <PageTitle eyebrow="Plan a date" title={plan ? `When could you and ${plan.other_display_name} meet?` : "When could you meet?"} lede="We only show windows where you both said you're free. Nobody sees the other person's full availability, and connected calendars share free/busy only." />
      <ErrorState error={error} retry={() => router.refresh()} />
      {!plan && !error && <Skeleton lines={5} label="Preparing your plan" />}
      {plan && closed && <StatusBanner type="caution" title="This plan is closed" body="Start a new plan from the conversation if you'd like to meet." action={<LinkButton href={`/messages/${plan.conversation_id}`} variant="secondary">Back to the conversation</LinkButton>} />}
      {plan && !closed && (
        <>
          {plan.status !== "draft" && plan.starts_at && <StatusBanner type="info" title="There is already a proposal on the table" body={`${plan.venue?.name ?? "A venue"} on ${formatDateTime(plan.starts_at, plan.timezone)}. Choosing a new window sends a change that ${plan.other_display_name} must reconfirm.`} action={<LinkButton href={`/dates/${plan.id}`} variant="secondary">See the current proposal</LinkButton>} />}
          {!concierge && (
            <StatusBanner type="info" title="Manual planning (free)" body="You see up to three overlapping windows and one venue suggestion. Matchmaker Pro adds the full overlap list and a balanced shortlist of three public venues." action={<LinkButton href="/you/membership" variant="ghost">See what membership includes</LinkButton>} />
          )}
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Overlapping windows in the next two weeks</h2>
            <p className="mb-3 text-sm text-ink-secondary">{overlaps.data?.note ?? "Only overlapping coarse windows are shown."}</p>
            {overlaps.isLoading && <Skeleton lines={4} label="Finding overlapping windows" />}
            {overlaps.error && <ErrorState error={overlaps.error as ApiError} retry={() => overlaps.refetch()} />}
            {overlaps.data && overlaps.data.items.length === 0 && (
              <EmptyState title="No overlapping window yet" body="Your recurring availability and theirs don't line up in the next 14 days. Adding a window or two on your side is the fastest fix; the other person is never told what you changed." action={<LinkButton href="/onboarding/availability" variant="secondary">Update my availability</LinkButton>} />
            )}
            {overlaps.data && overlaps.data.items.length > 0 && (
              <div role="radiogroup" aria-label="Overlapping windows" className="space-y-2">
                {overlaps.data.items.map((w) => (
                  <ChoiceCard key={w.starts_at} title={`${w.weekday} ${w.date}`} body={`${w.start}–${w.end} (${plan.timezone})`} selected={chosen?.starts_at === w.starts_at} onSelect={() => setChosen(w)} />
                ))}
              </div>
            )}
          </Card>
          {chosen && (
            <Card className="mb-4">
              <h2 className="mb-1 font-bold">Start time</h2>
              <p className="mb-2 text-sm text-ink-secondary">Pick a start inside that window. Dates default to two hours; the venue step can adjust it.</p>
              <label htmlFor="start" className="mb-1 block text-sm font-semibold">
                Start
              </label>
              <Select id="start" value={startAt} onChange={(e) => setStartAt(e.target.value)}>
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {formatDateTime(s, plan.timezone)}
                  </option>
                ))}
              </Select>
              <label className="mt-4 flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span className="text-sm text-ink">
                  I understand {plan.other_display_name} will see this <strong>one window</strong> as my suggestion. My other free times stay private, and nothing is sent until I propose a venue.
                </span>
              </label>
            </Card>
          )}
          <Button fullWidth disabled={!chosen || !startAt || !consent} onClick={goToVenues}>
            {chosen && startAt ? `Choose ${shortWhen(startAt, plan.timezone)} and pick a venue` : "Choose a window first"}
          </Button>
          <LinkButton href={`/messages/${plan.conversation_id}`} variant="ghost" fullWidth className="mt-2">
            Back to the conversation
          </LinkButton>
        </>
      )}
    </AppShell>
  );
}

export default function PlannerPage() {
  return (
    <Suspense>
      <PlannerInner />
    </Suspense>
  );
}
