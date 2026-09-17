"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, post } from "@/lib/api";
import { hoursLeft, formatDateTime } from "@/lib/format";
import type { Introduction } from "@/lib/types";
import { Button, ErrorState, StatusBanner, VerificationBadge, cx } from "@/components/ui";
import { INTRO_STATUS_LABEL } from "./types";

type Section = "card" | "why" | "considerations" | "decision";

const SECTIONS: { key: Section; label: string; path: string }[] = [
  { key: "card", label: "Introduction", path: "" },
  { key: "why", label: "Why", path: "/why" },
  { key: "considerations", label: "Considerations", path: "/considerations" },
  { key: "decision", label: "Decide", path: "/decision" },
];

/** Shared header for I01–I04: name, verification, status, deadline with the single extension, sub-navigation. */
export function IntroductionHeader({ intro, active, showExtend }: { intro: Introduction; active: Section; showExtend?: boolean }) {
  const name = intro.profile?.display_name ?? "Introduction";
  const hours = hoursLeft(intro.expires_at);
  const open = intro.status === "offered";
  return (
    <header className="mb-5">
      <Link href="/introductions" className="inline-flex min-h-11 items-center text-sm font-semibold text-action">
        ← All introductions
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">{name}</h1>
        {intro.profile && <VerificationBadge verified={intro.profile.verified} small />}
      </div>
      <p className="mt-1 text-sm text-ink-secondary">{INTRO_STATUS_LABEL[intro.status] ?? intro.status}</p>
      {intro.is_trial && open && <StatusBanner type="caution" title="Your trial introduction" body="One full introduction with the same evidence and privacy as Matchmaker Pro. Nothing is hidden or watered down." />}
      {open && intro.expires_at && <Deadline intro={intro} hours={hours} showExtend={!!showExtend} />}
      {intro.profile && (
        <nav aria-label="Introduction sections" className="mt-4 flex gap-1 overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface p-1">
          {SECTIONS.map((s) => (
            <Link key={s.key} href={`/introductions/${intro.id}${s.path}`} aria-current={active === s.key ? "page" : undefined} className={cx("min-h-11 flex-1 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-center text-sm font-semibold", active === s.key ? "bg-action-soft text-action" : "text-ink-secondary hover:bg-surface-muted")}>
              {s.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

function Deadline({ intro, hours, showExtend }: { intro: Introduction; hours: number | null; showExtend: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const extend = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await post<Introduction>(`/introductions/${intro.id}/extend`);
      qc.setQueryData(["introduction", intro.id], updated);
      qc.invalidateQueries({ queryKey: ["introductions"] });
      qc.invalidateQueries({ queryKey: ["today"] });
      setDone(true);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <p className="text-sm text-ink">
        <span className="font-semibold">Review window:</span> {hours !== null && hours > 0 ? `about ${hours} hour${hours === 1 ? "" : "s"} left` : "closing soon"} · closes {formatDateTime(intro.expires_at)}
      </p>
      <p className="mt-1 text-xs text-ink-tertiary">The window reflects real reciprocal availability, not artificial urgency. It can be extended once.</p>
      {done && <p className="mt-2 text-sm font-semibold text-success">Extended. The new closing time is shown above.</p>}
      <ErrorState error={error} />
      {showExtend && intro.extension_available && intro.actions.can_extend && !done && (
        <Button size="sm" variant="secondary" className="mt-2" loading={busy} onClick={extend}>
          Give me more time (once)
        </Button>
      )}
      {showExtend && !intro.extension_available && !done && <p className="mt-2 text-xs text-ink-tertiary">Your one extension has been used or is no longer available.</p>}
    </div>
  );
}
