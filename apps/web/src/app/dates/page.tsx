"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Card, EmptyState, ErrorState, LinkButton, PageTitle, Skeleton } from "@/components/ui";
import { DatePlanCard } from "@/components/dates/shared";
import type { DatePlan } from "@/lib/types";

/** Dates tab: upcoming, awaiting confirmation, past with a private feedback route. */
export default function DatesPage() {
  const { me } = useRequireMember();
  const q = useQuery({ queryKey: ["date-plans"], queryFn: () => get<{ items: DatePlan[] }>("/date-plans"), enabled: !!me });
  const items = q.data?.items ?? [];
  const now = Date.now();
  const awaiting = items.filter((p) => (p.status === "proposed" || p.status === "countered") && p.awaiting_your_confirmation);
  const pending = items.filter((p) => (p.status === "proposed" || p.status === "countered" || p.status === "draft") && !p.awaiting_your_confirmation);
  const upcoming = items.filter((p) => p.status === "confirmed" && (!p.starts_at || new Date(p.starts_at).getTime() > now));
  const past = items.filter((p) => !awaiting.includes(p) && !pending.includes(p) && !upcoming.includes(p));

  return (
    <AppShell>
      <PageTitle eyebrow="Dates" title="Plans, check-ins and feedback" lede="Dates start from a conversation you both chose. Everything here stays between the two of you and, if you want, a trusted contact." />
      {q.isLoading && <Skeleton lines={5} label="Loading your dates" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && items.length === 0 && (
        <EmptyState title="No dates yet" body="A date is planned from inside a mutual conversation: open Messages, pick the person, and choose “Plan a date”. Only overlapping availability is ever shown." action={<LinkButton href="/messages" variant="secondary">Open Messages</LinkButton>} />
      )}
      <Section title="Needs your answer" items={awaiting} />
      <Section title="Upcoming" items={upcoming} />
      <Section title="Waiting on the other person" items={pending} />
      <Section title="Past" items={past} />
      {items.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-1 font-bold">Safety on every date</h2>
          <p className="text-sm text-ink-secondary">Public venues only, a discreet calendar title, an optional check-in with a trusted contact, and 112 always one tap away. None of this depends on the AI.</p>
          <LinkButton href="/safety" variant="ghost" className="mt-2">
            Open the Safety Center
          </LinkButton>
        </Card>
      )}
    </AppShell>
  );
}

function Section({ title, items }: { title: string; items: DatePlan[] }) {
  if (!items.length) return null;
  return (
    <section className="mb-6" aria-labelledby={`sec-${title}`}>
      <h2 id={`sec-${title}`} className="mb-2 text-lg font-bold text-ink">
        {title}
      </h2>
      <ul className="space-y-3">
        {items.map((p) => (
          <DatePlanCard key={p.id} plan={p} />
        ))}
      </ul>
    </section>
  );
}
