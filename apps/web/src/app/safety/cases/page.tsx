"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, ErrorState, LinkButton, PageTitle, Skeleton } from "@/components/ui";
import { CaseCard, type SafetyCase } from "@/components/safety/shared";

/** S03 Case list: receipts and status for reports you made. */
export default function CasesPage() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const q = useQuery({ queryKey: ["safety-cases"], queryFn: () => get<{ items: SafetyCase[] }>("/safety/cases"), enabled: !!me });
  const open = q.data?.items.filter((c) => c.status !== "closed") ?? [];
  const closed = q.data?.items.filter((c) => c.status === "closed") ?? [];
  return (
    <AppShell>
      <PageTitle eyebrow="Safety · Cases" title="Your cases" lede="Status for every report you've made. Investigation methods, reporter identities and other people's private data are never shown here." />
      {q.isLoading && <Skeleton lines={4} label="Loading your cases" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No cases" body="If something ever feels wrong, you can report privately in a couple of taps." action={<LinkButton href="/safety/report" variant="secondary">Report someone</LinkButton>} />}
      {open.length > 0 && (
        <section className="mb-6" aria-labelledby="open-cases">
          <h2 id="open-cases" className="mb-2 text-lg font-bold">
            Open
          </h2>
          <ul className="space-y-3">
            {open.map((c) => (
              <CaseCard key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}
      {closed.length > 0 && (
        <section aria-labelledby="closed-cases">
          <h2 id="closed-cases" className="mb-2 text-lg font-bold">
            Closed
          </h2>
          <ul className="space-y-3">
            {closed.map((c) => (
              <CaseCard key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
