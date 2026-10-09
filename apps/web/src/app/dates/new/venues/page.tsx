"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, newIdempotencyKey, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, LinkButton, PageTitle, Select, Skeleton, StatusBanner, cx } from "@/components/ui";
import { planTimeLine } from "@/lib/format";
import { DATE_STYLES, VenueCard, shortWhen, useDatePlan, type VenuesOut } from "@/components/dates/shared";
import type { DatePlan } from "@/lib/types";

/** D02 Safe venue selection: three public options with travel balance, price, accessibility, atmosphere. One proposal. */
function VenuesInner() {
  const { me } = useRequireMember();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const planId = params.get("plan");
  const startsAtParam = params.get("starts_at");
  const plan = useDatePlan(planId);
  const [style, setStyle] = useState<string>(params.get("style") ?? "");
  const [venueId, setVenueId] = useState<string | null>(null);
  const [duration, setDuration] = useState(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [key] = useState(() => newIdempotencyKey());

  const startsAt = startsAtParam ?? plan.data?.starts_at ?? null;
  const concierge = me?.capabilities.entitlements.date_concierge ?? false;
  const venues = useQuery({ queryKey: ["date-plan", planId, "venues", style], queryFn: () => get<VenuesOut>(`/date-plans/${planId}/venues${style ? `?style=${encodeURIComponent(style)}` : ""}`), enabled: !!planId });

  useEffect(() => {
    if (plan.data && !startsAt) router.replace(`/dates/new?plan=${plan.data.id}`);
  }, [plan.data, startsAt, router]);
  useEffect(() => {
    if (plan.data?.date_style && !style) setStyle(plan.data.date_style);
  }, [plan.data?.date_style, style]);

  const selected = venues.data?.items.find((v) => v.id === venueId) ?? null;

  const propose = async () => {
    if (!plan.data || !selected || !startsAt) return;
    setBusy(true);
    setError(null);
    try {
      const next = await post<DatePlan>(`/date-plans/${plan.data.id}/proposals`, { starts_at: startsAt, duration_minutes: duration, venue_id: selected.id, date_style: style || null }, { ifMatch: plan.data.version, idempotencyKey: key });
      qc.setQueryData(["date-plan", next.id], next);
      await qc.invalidateQueries({ queryKey: ["date-plans"] });
      router.push(`/dates/${next.id}`);
    } catch (e) {
      setError(e as ApiError);
      if ((e as ApiError).code === "VERSION_MISMATCH") plan.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageTitle eyebrow="Plan a date · venue" title="Pick a public place" lede={plan.data && startsAt ? `For ${planTimeLine(startsAt, plan.data.timezone)} with ${plan.data.other_display_name}.` : undefined} />
      {plan.isLoading && <Skeleton lines={4} label="Loading your plan" />}
      {plan.error && <ErrorState error={plan.error as ApiError} retry={() => plan.refetch()} />}
      <ErrorState error={error} retry={error?.code === "VERSION_MISMATCH" ? () => plan.refetch() : undefined} />
      {plan.data && (
        <>
          {!concierge && <StatusBanner type="info" title="One suggestion on the free plan" body="Matchmaker Pro balances travel for both of you across three public options. Manual planning always works." action={<LinkButton href="/you/membership" variant="ghost">See membership</LinkButton>} />}
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Date style</h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Date style">
              <button type="button" aria-pressed={style === ""} onClick={() => setStyle("")} className={cx("rounded-full border px-3 py-2 text-sm font-semibold", style === "" ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                Any
              </button>
              {DATE_STYLES.map((s) => (
                <button key={s.value} type="button" aria-pressed={style === s.value} onClick={() => setStyle(s.value)} className={cx("rounded-full border px-3 py-2 text-sm font-semibold", style === s.value ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                  {s.label}
                </button>
              ))}
            </div>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Public options</h2>
            <ul className="mb-3 list-disc pl-5 text-sm text-ink-secondary">
              {(venues.data?.rules ?? ["Public places only for a first date.", "Travel is balanced using coarse zones, never exact addresses."]).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {venues.isLoading && <Skeleton lines={4} label="Finding public venues" />}
            {venues.error && <ErrorState error={venues.error as ApiError} retry={() => venues.refetch()} />}
            {venues.data && venues.data.items.length === 0 && <EmptyState title="No venue matches that style" body="Try another style. Every option is a staffed public place in your city." />}
            {venues.data && venues.data.items.length > 0 && (
              <div role="radiogroup" aria-label="Venue options" className="space-y-2">
                {venues.data.items.map((v) => (
                  <VenueCard key={v.id} venue={v} selected={venueId === v.id} onSelect={() => setVenueId(v.id)} otherName={plan.data?.other_display_name ?? "them"} />
                ))}
              </div>
            )}
          </Card>
          <Card className="mb-4">
            <label htmlFor="duration" className="mb-1 block text-sm font-semibold">
              How long
            </label>
            <Select id="duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={60}>About an hour</option>
              <option value={90}>An hour and a half</option>
              <option value={120}>Two hours</option>
              <option value={180}>Three hours</option>
            </Select>
            <p className="mt-2 text-sm text-ink-secondary">{plan.data.other_display_name} must confirm before anything is fixed. If either of you changes the plan later, you both reconfirm.</p>
          </Card>
          <Button fullWidth loading={busy} disabled={!selected || !startsAt} onClick={propose}>
            {selected && startsAt ? `Propose ${selected.name} on ${shortWhen(startsAt, plan.data.timezone)}` : "Choose a venue to propose"}
          </Button>
          <LinkButton href={`/dates/new?plan=${plan.data.id}`} variant="ghost" fullWidth className="mt-2">
            Change the time
          </LinkButton>
        </>
      )}
    </AppShell>
  );
}

export default function VenuesPage() {
  return (
    <Suspense>
      <VenuesInner />
    </Suspense>
  );
}
