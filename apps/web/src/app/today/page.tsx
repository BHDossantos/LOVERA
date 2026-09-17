"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { hoursLeft } from "@/lib/format";
import type { TodayTask } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { Card, EmptyState, ErrorState, LinkButton, PageTitle, Skeleton, cx } from "@/components/ui";

type Today = {
  next_action: TodayTask;
  tasks: TodayTask[];
  readiness: { date_ready: boolean; verification: string; blueprint_fresh: boolean; plan: string; trial_introductions_remaining: number };
  introduction_timing: { cadence: string; cap: number };
  unread_notifications: number;
  safety_shortcut: string;
};

const VERIFICATION_LABEL: Record<string, string> = { verified: "Verified", pending: "Under review", pending_review: "Under review", not_started: "Not started", failed: "Needs attention", expired: "Expired" };

/** T01 Today: one next best action ranked by member outcome, never a feed. */
export default function TodayPage() {
  const { me } = useRequireMember();
  const q = useQuery({ queryKey: ["today"], queryFn: () => get<Today>("/today"), enabled: !!me, refetchInterval: 60_000 });

  return (
    <AppShell>
      <PageTitle eyebrow="Today" title="What should I do now?" lede="One task at a time, ranked by what moves you toward a real date. Less time in the app is fine." />
      {q.isLoading && <Skeleton lines={5} label="Loading your next action" />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && <TodayBody data={q.data} />}
    </AppShell>
  );
}

function TodayBody({ data }: { data: Today }) {
  const next = data.next_action;
  const rest = data.tasks.filter((t) => t.key !== next.key);
  const r = data.readiness;
  return (
    <div className="space-y-6">
      <Card as="section" aria-labelledby="next-action" className="border-action bg-action-soft/40">
        <p className="text-sm font-semibold uppercase tracking-wide text-action">Next best action</p>
        <h2 id="next-action" className="mt-1 text-xl font-bold text-ink">
          {next.title}
        </h2>
        <p className="mt-1 text-ink-secondary">{next.body}</p>
        <DeadlineNote deadline={next.deadline} />
        <LinkButton href={next.path} className="mt-4" fullWidth>
          {next.cta}
        </LinkButton>
      </Card>

      {rest.length > 0 ? (
        <section aria-labelledby="also">
          <h2 id="also" className="mb-2 text-base font-semibold text-ink">
            Also on your plate
          </h2>
          <ul className="space-y-2">
            {rest.map((t) => (
              <Card key={t.key} as="li" className="p-4">
                <Link href={t.path} className="flex min-h-11 items-center justify-between gap-3">
                  <span>
                    <span className="block font-semibold text-ink">{t.title}</span>
                    <span className="block text-sm text-ink-secondary">{t.body}</span>
                    <DeadlineNote deadline={t.deadline} />
                  </span>
                  <span aria-hidden className="text-action">
                    →
                  </span>
                </Link>
              </Card>
            ))}
          </ul>
        </section>
      ) : (
        next.key === "waiting" && <EmptyState title="Your plate is clear" body="Introductions arrive with the weekly batch after concierge review. We never invent activity to bring you back." />
      )}

      <section aria-labelledby="readiness">
        <h2 id="readiness" className="mb-2 text-base font-semibold text-ink">
          Readiness
        </h2>
        <Card className="p-0">
          <ul className="divide-y divide-border">
            <ReadinessRow label="Ready to date" ok={r.date_ready} value={r.date_ready ? "On" : "Paused"} href="/you/profile" />
            <ReadinessRow label="Verification" ok={r.verification === "verified"} value={VERIFICATION_LABEL[r.verification] ?? r.verification} href="/you/verification" />
            <ReadinessRow label="Dating Blueprint" ok={r.blueprint_fresh} value={r.blueprint_fresh ? "Fresh" : "Needs a refresh"} href="/you/blueprint" />
            <ReadinessRow label="Introduction timing" ok value={`${data.introduction_timing.cadence === "weekly" ? "Weekly batch" : data.introduction_timing.cadence} · up to ${data.introduction_timing.cap} at a time`} href="/introductions" />
            <ReadinessRow label="Plan" ok={r.plan !== "free"} value={r.plan === "free" ? `Verified (free)${r.trial_introductions_remaining > 0 ? ` · ${r.trial_introductions_remaining} trial introduction left` : ""}` : "Matchmaker Pro"} href="/you/membership" />
          </ul>
        </Card>
      </section>

      <Card as="section" aria-labelledby="safety" className="flex items-center justify-between gap-3">
        <div>
          <h2 id="safety" className="font-semibold text-ink">
            Safety, any time
          </h2>
          <p className="text-sm text-ink-secondary">Report, block, check-ins and emergency contacts are free and always one tap away.</p>
        </div>
        <LinkButton href={data.safety_shortcut || "/safety"} variant="secondary">
          Open Safety
        </LinkButton>
      </Card>
    </div>
  );
}

function ReadinessRow({ label, value, ok, href }: { label: string; value: string; ok: boolean; href: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
        <span className="text-sm text-ink-secondary">{label}</span>
        <span className={cx("inline-flex items-center gap-1 text-sm font-medium", ok ? "text-success" : "text-context")}>
          <span aria-hidden>{ok ? "✓" : "○"}</span>
          {value}
        </span>
      </Link>
    </li>
  );
}

function DeadlineNote({ deadline }: { deadline?: string }) {
  if (!deadline) return null;
  const h = hoursLeft(deadline);
  if (h === null) return null;
  return <span className="mt-1 block text-xs text-ink-tertiary">Review window: about {h} hour{h === 1 ? "" : "s"} left · extendable once</span>;
}
