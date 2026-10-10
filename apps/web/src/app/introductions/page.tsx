"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { hoursLeft, relative } from "@/lib/format";
import type { Introduction } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { Avatar, Card, ErrorState, PageTitle, Skeleton, VerificationBadge, cx } from "@/components/ui";
import type { IntroductionList } from "@/components/introductions/types";
import { INTRO_STATUS_LABEL } from "@/components/introductions/types";
import { WaitingCard } from "@/components/introductions/WaitingCard";

/** Introductions tab: the current reciprocal candidate, mutual yeses, and a quiet history. */
export default function IntroductionsPage() {
  const { me } = useRequireMember();
  const q = useQuery({ queryKey: ["introductions"], queryFn: () => get<IntroductionList>("/introductions"), enabled: !!me });

  return (
    <AppShell>
      <PageTitle eyebrow="Introductions" title="Who the matchmaker chose, and why" lede="A few explained, reciprocal introductions at a time. No stack, no likes, no rankings." />
      {q.isLoading && <Skeleton lines={5} label="Loading introductions" />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && (
        <div className="space-y-6">
          {q.data.current.length > 0 ? (
            <section aria-labelledby="current">
              <h2 id="current" className="mb-2 text-base font-semibold text-ink">
                Waiting for your private decision
              </h2>
              <ul className="space-y-2">
                {q.data.current.map((i) => (
                  <IntroRow key={i.id} intro={i} />
                ))}
              </ul>
            </section>
          ) : (
            q.data.waiting && <WaitingCard waiting={q.data.waiting} />
          )}
          {q.data.mutual.length > 0 && (
            <section aria-labelledby="mutual">
              <h2 id="mutual" className="mb-2 text-base font-semibold text-ink">
                You both said yes
              </h2>
              <ul className="space-y-2">
                {q.data.mutual.map((i) => (
                  <IntroRow key={i.id} intro={i} />
                ))}
              </ul>
            </section>
          )}
          {q.data.history.length > 0 && (
            <section aria-labelledby="history">
              <h2 id="history" className="mb-2 text-base font-semibold text-ink">
                Earlier
              </h2>
              <p className="mb-2 text-sm text-ink-secondary">Closed introductions. Whether they closed by your choice, theirs, or the calendar is never shown to the other person.</p>
              <ul className="space-y-2">
                {q.data.history.map((i) => (
                  <IntroRow key={i.id} intro={i} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}

function IntroRow({ intro }: { intro: Introduction }) {
  const name = intro.profile?.display_name ?? "Introduction";
  const hours = hoursLeft(intro.expires_at);
  const open = intro.status === "offered";
  const href = intro.status === "mutual" ? `/introductions/${intro.id}/mutual` : `/introductions/${intro.id}`;
  return (
    <Card as="li" className={cx("p-4", open && "border-action")}>
      <Link href={href} className="flex min-h-11 items-center justify-between gap-3">
        {/* The detail screen deliberately puts the reasons above the photo, because that is
            where the decision is made. This is not that screen: here the photo is identity —
            which of these am I looking at — and a list of names with no faces in it is what
            made this read as a directory rather than as somewhere people are. */}
        <Avatar name={name} url={intro.profile?.media?.find((m) => m.type === "photo" && m.url)?.url ?? null} size={52} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{name}</span>
            {intro.profile && <VerificationBadge verified={intro.profile.verified} small />}
            {intro.is_trial && <span className="rounded-full bg-context-soft px-2 py-0.5 text-xs font-semibold text-context">Trial</span>}
          </span>
          <span className="mt-0.5 block text-sm text-ink-secondary">
            {INTRO_STATUS_LABEL[intro.status] ?? intro.status}
            {open && hours !== null && ` · about ${hours} h left`}
            {!open && intro.offered_at && ` · ${relative(intro.offered_at)}`}
          </span>
        </span>
        <span aria-hidden className="text-action">
          →
        </span>
      </Link>
    </Card>
  );
}
