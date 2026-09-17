"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Card, ErrorState, LinkButton, PageTitle, Skeleton } from "@/components/ui";
import { useDatePlan, type Outcome } from "@/components/dates/shared";

/** D06 Mutual second date: a positive result only when both said yes; every other state reads exactly the same. */
export default function MutualSecondDatePage({ params }: { params: Promise<{ dateId: string }> }) {
  const { dateId } = use(params);
  const { me } = useRequireMember();
  const plan = useDatePlan(dateId);
  const outcome = useQuery({ queryKey: ["date-plan", dateId, "outcome"], queryFn: () => get<Outcome>(`/date-plans/${dateId}/mutual-outcome`), enabled: !!me });
  const o = outcome.data;
  const mutual = o?.state === "mutual_second_date";
  const conversationId = o?.conversation_id ?? plan.data?.conversation_id;

  return (
    <AppShell>
      {outcome.isLoading && <Skeleton lines={4} label="Checking the outcome" />}
      {outcome.error && <ErrorState error={outcome.error as ApiError} retry={() => outcome.refetch()} />}
      {o && mutual && (
        <>
          <PageTitle eyebrow="It's mutual" title={`You and ${plan.data?.other_display_name ?? "your date"} both want a second date`} lede="Both of you said yes privately, so we can say it out loud. No pressure on timing." />
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Next steps</h2>
            <ul className="list-disc pl-5 text-ink-secondary">
              {(o.next_steps ?? []).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Card>
          {conversationId && (
            <LinkButton href={`/messages/${conversationId}`} fullWidth>
              Continue the conversation
            </LinkButton>
          )}
          {conversationId && (
            <LinkButton href={`/dates/new?conversation=${conversationId}`} variant="secondary" fullWidth className="mt-2">
              Plan a second date
            </LinkButton>
          )}
        </>
      )}
      {o && !mutual && (
        <>
          <PageTitle eyebrow="Second date" title="Nothing to show here yet" lede="You'll see a result on this page only if you both said yes. Nothing about a one-sided answer is ever shown, to either of you." />
          <Card className="mb-4">
            <p className="text-ink-secondary">This page looks the same whether the other person hasn't answered, answered differently, or you haven't answered yet. That's deliberate: neither of you can infer the other's private choice.</p>
          </Card>
          {plan.data && !plan.data.feedback_submitted && plan.data.feedback_open && (
            <LinkButton href={`/dates/${dateId}/feedback`} fullWidth>
              Give my private feedback
            </LinkButton>
          )}
        </>
      )}
      <LinkButton href="/dates" variant="ghost" fullWidth className="mt-2">
        Back to Dates
      </LinkButton>
    </AppShell>
  );
}
