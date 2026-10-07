"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, post } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { ConversationSummary } from "@/lib/types";
import { Avatar, Button, ErrorState, Modal, VerificationBadge, cx } from "@/components/ui";
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
  // Not `other.member_id`: that is null once the conversation closes, so an ended thread produced
  // a subjectless report — reaching a reviewer who cannot act on anybody — and had no way to block.
  const subjectId = conversation.safety.subject_id;
  const reportHref = subjectId ? `/safety/report?subject=${subjectId}&conversation=${conversation.id}` : `/safety/report?conversation=${conversation.id}`;
  const qc = useQueryClient();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState<ApiError | null>(null);

  /**
   * Blocking from the conversation, through POST /blocks.
   *
   * The web app called that endpoint nowhere: the only way to block was the question on the way out
   * of an *active* conversation, so somebody who simply wanted contact to stop after a thread had
   * already ended had to accuse them of something in a report first.
   */
  const doBlock = async () => {
    if (!subjectId) return;
    setBlocking(true);
    setBlockError(null);
    try {
      await post("/blocks", { member_id: subjectId });
      qc.removeQueries({ queryKey: ["date-plan"] });
      qc.removeQueries({ queryKey: ["introduction"] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["conversations"] }),
        qc.invalidateQueries({ queryKey: ["conversation", conversation.id] }),
        qc.invalidateQueries({ queryKey: ["blocks"] }),
        qc.invalidateQueries({ queryKey: ["today"] }),
        // create_block cancels every open date plan on the conversation and closes any open
        // introduction between the two, so neither may keep showing them as live. The detail
        // queries are removed rather than invalidated: invalidate leaves the data in place, and a
        // cancelled date rendering with Confirm still on it is the failure this is for.
        qc.invalidateQueries({ queryKey: ["date-plans"] }),
        qc.invalidateQueries({ queryKey: ["introductions"] }),
      ]);
      setConfirmBlock(false);
    } catch (e) {
      setBlockError(e as ApiError);
    } finally {
      setBlocking(false);
    }
  };

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
        {/* Offered once there is somebody to act on and they are not already blocked: repeating an
            action already taken reads as if the first one did not work. Report stays either way,
            because having blocked somebody is not a reason to be unable to report them. */}
        {!!subjectId && !conversation.safety.blocked_by_you && (
          <button type="button" onClick={() => setConfirmBlock(true)} className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-sm font-semibold text-ink hover:bg-surface-muted" aria-label="Block this member">
            Block
          </button>
        )}
      </div>
      {conversation.safety.blocked_by_you && <p className="mt-1 text-sm text-ink-secondary">Blocked. Undo it in the safety centre.</p>}
      <Modal open={confirmBlock} title={`Block ${other.display_name}?`} onClose={() => setConfirmBlock(false)}>
        <p className="mb-3 text-sm text-ink-secondary">
          This ends the conversation and cancels any date you had planned. They are never told you blocked them — only
          that you are unavailable. You can undo it from the safety centre.
        </p>
        <ErrorState error={blockError} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="danger" loading={blocking} onClick={doBlock}>
            Block
          </Button>
          <Button variant="secondary" onClick={() => setConfirmBlock(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
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
