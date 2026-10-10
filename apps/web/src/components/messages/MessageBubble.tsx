"use client";

import { formatDateTime, LANG_LABEL } from "@/lib/format";
import type { Message } from "@/lib/types";
import { Button, cx } from "@/components/ui";
import type { PendingMessage } from "./types";

type State = "sending" | "sent" | "failed" | "flagged" | "hidden";

function stateOf(m: Message): State {
  if (m.moderation_state === "hidden") return "hidden";
  if (m.moderation_state === "flagged") return "flagged";
  return "sent";
}

export function MessageBubble({ message }: { message: Message }) {
  const state = stateOf(message);
  const meta = message.meta as { draft_assisted?: boolean; translated_from?: string | null; source_lang?: string | null };
  return (
    <Bubble mine={message.mine} state={state} text={state === "hidden" ? "" : message.text} time={formatDateTime(message.sent_at)} voice={message.type === "voice"} assisted={!!meta.draft_assisted} translatedFrom={meta.translated_from ?? null} replyingTo={message.replying_to ?? null} />
  );
}

export function PendingBubble({ pending, onRetry, onDiscard }: { pending: PendingMessage; onRetry: () => void; onDiscard: () => void }) {
  return <Bubble mine state={pending.state} text={pending.text} error={pending.error} onRetry={onRetry} onDiscard={onDiscard} translatedFrom={pending.source_lang ?? null} />;
}

function Bubble({ mine, state, text, time, error, voice, assisted, translatedFrom, replyingTo, onRetry, onDiscard }: { mine: boolean; state: State; text: string; time?: string; error?: string; voice?: boolean; assisted?: boolean; translatedFrom?: string | null; replyingTo?: { label: string; answer: string } | null; onRetry?: () => void; onDiscard?: () => void }) {
  const tone = mine ? "bg-action text-ink-inverse" : "bg-surface text-ink border border-border";
  return (
    <li className={cx("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[85%] rounded-[var(--radius-lg)] px-4 py-3", tone, state === "failed" && "border border-caution bg-caution-soft text-ink", state === "sending" && "opacity-70")}>
        {/* The prompt this answers, so the message reads as a reply to something rather than as
            an opening line out of nowhere. Resolved when it was sent, so it still says what they
            said at the time even if they have since edited the prompt. */}
        {!!replyingTo && state !== "hidden" && (
          <div className={cx("mb-2 border-l-[3px] pl-2.5", mine ? "border-white/50" : "border-action")}>
            <p className={cx("text-[0.6875rem] font-bold uppercase tracking-[0.14em]", mine ? "text-white/75" : "text-context")}>{replyingTo.label}</p>
            <p className={cx("text-sm", mine ? "text-white/90" : "text-ink-secondary")}>{replyingTo.answer}</p>
          </div>
        )}
        {state === "hidden" ? (
          <p className="text-sm italic text-ink-secondary">This message was hidden by the safety team.</p>
        ) : (
          <p className="whitespace-pre-wrap break-words">
            {voice && <span className="mr-1" aria-label="Voice note transcript">🎙</span>}
            {text}
          </p>
        )}
        <p className={cx("mt-1 flex flex-wrap items-center gap-2 text-xs", mine && state !== "failed" ? "text-white/80" : "text-ink-tertiary")}>
          {time && <span>{time}</span>}
          {state === "sending" && <span>Sending…</span>}
          {state === "failed" && <span className="font-semibold text-caution">Not sent{error ? ` · ${error}` : ""}</span>}
          {state === "flagged" && <span className="font-semibold">⚑ Under safety review</span>}
          {assisted && <span title="Written with the AI Wingman, reviewed and sent by the member">✎ AI-assisted</span>}
          {translatedFrom && <span>Translated from {LANG_LABEL[translatedFrom] ?? translatedFrom}</span>}
        </p>
        {state === "failed" && (
          <div className="mt-2 flex gap-2">
            {onRetry && (
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            )}
            {onDiscard && (
              <Button size="sm" variant="ghost" onClick={onDiscard}>
                Discard
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
