"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, ErrorState, Skeleton, StatusBanner } from "@/components/ui";
import { AdminShell, STAFF_ROLES, StatTile, hasAnyRole } from "@/components/admin/AdminShell";
import { formatDateTime } from "@/lib/format";

type Run = { id: string; market_id: string; cohort_date: string; status: string; candidate_count: number; allocation_count: number; stats: Record<string, unknown>; started_at: string | null; finished_at: string | null };
type Marketplace = {
  members_by_status: Record<string, number>;
  active_by_gender: Record<string, number>;
  balance_warning: string | null;
  introductions_by_status: Record<string, number>;
  paid_members: number;
  credits_granted: number;
  funnel: { introductions_offered: number; mutual: number; dates_confirmed: number; dates_completed: number; mutual_second_dates: number; p0_p1_reports: number; north_star_per_100_active: number };
  latest_run: Run | null;
  queues: { verification_review: number; safety_open: number; appeals_open: number };
};

const WORKSPACES = [
  { href: "/admin/matching", label: "Concierge matching", body: "Runs, proposed pairs, approve / reject, publish.", roles: ["concierge", "admin"] as const },
  { href: "/admin/verification", label: "Verification review", body: "Failed or escalated checks: approve, recheck, reject.", roles: ["safety_reviewer", "admin"] as const },
  { href: "/admin/safety", label: "Safety cases", body: "Severity-ordered queue, evidence, protective actions.", roles: ["safety_reviewer", "admin"] as const },
  { href: "/admin/safety/appeals", label: "Appeals", body: "Independent second review of adverse decisions.", roles: ["safety_reviewer", "admin"] as const },
  { href: "/admin/members", label: "Support", body: "Account status and onboarding diagnostics.", roles: ["support", "concierge", "safety_reviewer", "admin"] as const },
  { href: "/admin/audit", label: "Audit log", body: "Every sensitive action with actor, purpose and hash.", roles: ["admin"] as const },
];

/** Console home: marketplace dashboard and workspace links. Aggregated views only. */
export default function AdminHome() {
  const { me } = useAuth();
  const canSeeMarketplace = hasAnyRole(me?.roles, ["concierge", "support", "admin"]);
  const q = useQuery({ queryKey: ["admin", "marketplace"], queryFn: () => get<Marketplace>("/admin/marketplace"), enabled: !!me && canSeeMarketplace, refetchInterval: 60_000 });
  const m = q.data;
  return (
    <AdminShell title="Operations overview" roles={STAFF_ROLES}>
      {canSeeMarketplace ? (
        <>
          {q.isLoading && <Skeleton lines={5} label="Loading marketplace dashboard" />}
          {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
          {m?.balance_warning && <StatusBanner type="caution" title="Cohort balance warning" body={m.balance_warning} />}
          {m && (
            <>
              <section className="mb-6" aria-labelledby="ns">
                <h2 id="ns" className="mb-2 text-lg font-bold">
                  North Star
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile label="Mutual second dates per 100 active" value={m.funnel.north_star_per_100_active} hint="Both said yes privately" />
                  <StatTile label="Mutual second dates" value={m.funnel.mutual_second_dates} />
                  <StatTile label="Paid members" value={m.paid_members} />
                  <StatTile label="Protected credits granted" value={m.credits_granted} />
                </div>
              </section>
              <section className="mb-6" aria-labelledby="members">
                <h2 id="members" className="mb-2 text-lg font-bold">
                  Members
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Object.entries(m.members_by_status).map(([k, v]) => (
                    <StatTile key={k} label={k.replace(/_/g, " ")} value={v} />
                  ))}
                </div>
                <p className="mt-2 text-sm text-ink-secondary">
                  Active by gender: {Object.entries(m.active_by_gender).map(([g, n]) => `${g.replace(/_/g, " ")} ${n}`).join(" · ") || "—"}
                </p>
              </section>
              <section className="mb-6" aria-labelledby="funnel">
                <h2 id="funnel" className="mb-2 text-lg font-bold">
                  Funnel
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatTile label="Introductions offered" value={m.funnel.introductions_offered} />
                  <StatTile label="Mutual acceptances" value={m.funnel.mutual} />
                  <StatTile label="Dates confirmed" value={m.funnel.dates_confirmed} />
                  <StatTile label="Dates completed" value={m.funnel.dates_completed} />
                  <StatTile label="P0/P1 reports" value={m.funnel.p0_p1_reports} hint="Severe-harm queue" />
                  <StatTile label="Intros by status" value={Object.entries(m.introductions_by_status).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"} />
                </div>
              </section>
              <section className="mb-6" aria-labelledby="queues">
                <h2 id="queues" className="mb-2 text-lg font-bold">
                  Queues
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  <StatTile label="Verification review" value={m.queues.verification_review} />
                  <StatTile label="Open safety cases" value={m.queues.safety_open} />
                  <StatTile label="Open appeals" value={m.queues.appeals_open} />
                </div>
              </section>
              {m.latest_run && (
                <Card className="mb-6">
                  <h2 className="mb-1 font-bold">Latest match run</h2>
                  <p className="text-sm text-ink-secondary">
                    {m.latest_run.market_id} · cohort {m.latest_run.cohort_date} · {m.latest_run.status} · {m.latest_run.allocation_count} allocated of {m.latest_run.candidate_count} candidates · {formatDateTime(m.latest_run.finished_at ?? m.latest_run.started_at)}
                  </p>
                </Card>
              )}
            </>
          )}
        </>
      ) : (
        <StatusBanner type="info" title="Marketplace dashboard is for concierge, support and admin roles" body="Your workspaces are listed below." />
      )}
      <section aria-labelledby="ws">
        <h2 id="ws" className="mb-2 text-lg font-bold">
          Workspaces
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {WORKSPACES.filter((w) => hasAnyRole(me?.roles, [...w.roles])).map((w) => (
            <li key={w.href}>
              <Link href={w.href} className="block rounded-[var(--radius-lg)] border border-border bg-surface p-4 hover:bg-surface-muted">
                <span className="block font-semibold text-ink">{w.label}</span>
                <span className="block text-sm text-ink-secondary">{w.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </AdminShell>
  );
}
