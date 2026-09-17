"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Card, ErrorState, PageTitle, Skeleton } from "@/components/ui";
import { EmergencyCard, type SafetyCenter } from "@/components/safety/shared";

/** S01 Safety Center: emergency guidance, report, blocks, check-ins, education, case status. Free and independent of the AI. */
export default function SafetyPage() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const q = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetyCenter>("/safety"), enabled: !!me });
  const s = q.data;
  const counts: Record<string, string | null> = { cases: s ? (s.open_cases ? `${s.open_cases} open` : "none open") : null, block: s ? `${s.blocks} blocked` : null };
  return (
    <AppShell>
      <PageTitle eyebrow="Safety Center" title="Get help, report, or stop contact" lede="Everything here is free, private, handled by people, and keeps working if the AI is unavailable." />
      <EmergencyCard emergency={s?.emergency ?? { number: "112", note: "EU-wide emergency number." }} disclaimer={s?.disclaimer} />
      {q.isLoading && <Skeleton lines={4} label="Loading safety options" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      <Card className="mb-4">
        <h2 className="mb-2 font-bold">What would you like to do?</h2>
        <ul className="space-y-2">
          {(s?.actions ?? [
            { key: "report", label: "Report someone", path: "/safety/report" },
            { key: "block", label: "Blocked members", path: "/safety/blocks" },
            { key: "checkin", label: "Date check-ins", path: "/dates" },
            { key: "cases", label: "Your cases", path: "/safety/cases" },
            { key: "review", label: "Account decisions and appeals", path: "/account/review" },
          ]).map((a) => (
            <li key={a.key}>
              <Link href={a.path} className={`flex min-h-14 items-center justify-between rounded-[var(--radius-lg)] border px-4 py-3 font-semibold ${a.key === "report" ? "border-ink bg-ink text-white" : "border-border bg-surface text-ink hover:bg-surface-muted"}`}>
                <span>{a.label}</span>
                <span className="text-sm font-normal opacity-80">{counts[a.key] ?? ""} →</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-2 font-bold">Good to know</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
          {(s?.education ?? ["Never send money to someone you met here.", "Keep first dates public and tell a trusted contact.", "You can block without explaining. Blocking is silent.", "Reports stay private and never affect your matching."]).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-ink-tertiary">Reports go to a trained team, not an algorithm. Severe-harm, child-safety and intimate-image reports enter specialist procedures. We never tell the other person who reported them.</p>
    </AppShell>
  );
}
