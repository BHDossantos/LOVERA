"use client";

import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { ConversationSummary } from "@/lib/types";
import { Avatar, VerificationBadge, cx } from "@/components/ui";
import { CONVERSATION_STATUS_LABEL } from "./types";

export const DATE_STATUS_LABEL: Record<string, string> = { proposed: "Date proposed", countered: "New time suggested", confirmed: "Date confirmed", completed: "Date happened" };

export function dateContext(c: ConversationSummary) {
  if (!c.date) return null;
  const label = DATE_STATUS_LABEL[c.date.status] ?? c.date.status;
  return c.date.starts_at ? `${label} · ${formatDateTime(c.date.starts_at)}` : label;
}

/** Verified header with the block/report route always within two taps. */
export function ConversationHeader({ conversation, active }: { conversation: ConversationSummary; active?: "chat" | "assistant" | "translate" | "readiness" | "close" }) {
  const other = conversation.other;
  const photo = other.media.find((m) => m.url)?.url ?? null;
  const ended = conversation.status !== "active";
  const reportHref = other.member_id ? `/safety/report?subject=${other.member_id}&conversation=${conversation.id}` : `/safety/report?conversation=${conversation.id}`;
  const shortcuts: { key: NonNullable<typeof active>; label: string; href: string; aria: string }[] = [
    { key: "assistant", label: "AI Wingman", href: `/messages/${conversation.id}/assistant`, aria: "AI Wingman: get an editable draft" },
    { key: "translate", label: "Translate", href: `/messages/${conversation.id}/translate`, aria: "Translate a message" },
    { key: "readiness", label: "Voice & video", href: `/messages/${conversation.id}/readiness`, aria: "Voice and video readiness" },
    { key: "close", label: "End", href: `/messages/${conversation.id}/close`, aria: "Respectfully end this conversation" },
  ];
  return (
    <header className="mb-3">
      <Link href="/messages" className="inline-flex min-h-11 items-center text-sm font-semibold text-action">
        ← Messages
      </Link>
      <div className="mt-1 flex items-center gap-3">
        <Avatar name={other.display_name} url={photo} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold leading-tight text-ink">
            {active && active !== "chat" ? <Link href={`/messages/${conversation.id}`}>{other.display_name}</Link> : other.display_name}
            <VerificationBadge verified={other.verified} small />
          </h1>
          <p className="text-sm text-ink-secondary">{ended ? (CONVERSATION_STATUS_LABEL[conversation.status] ?? conversation.status) : (dateContext(conversation) ?? "Reciprocal introduction · verified context")}</p>
        </div>
        <Link href={reportHref} className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-sm font-semibold text-ink hover:bg-surface-muted" aria-label="Report or block this member">
          🛡 Report
        </Link>
      </div>
      {conversation.date && (
        <Link href={`/dates/${conversation.date.date_plan_id}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-action">
          See the date plan →
        </Link>
      )}
      <nav aria-label="Conversation tools" className="mt-3 flex gap-1 overflow-x-auto">
        {!ended && (
          <Link href={`/dates/new?conversation=${conversation.id}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-action px-4 text-sm font-semibold text-white">
            Plan a date
          </Link>
        )}
        {shortcuts.map((s) => (
          <Link key={s.key} href={s.href} aria-label={s.aria} aria-current={active === s.key ? "page" : undefined} className={cx("inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold", active === s.key ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink hover:bg-surface-muted", ended && s.key !== "close" && "opacity-60")}>
            {s.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
