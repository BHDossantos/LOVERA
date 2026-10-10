"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import type { Message } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { Button, ErrorState, LinkButton, Skeleton, StatusBanner, cx } from "@/components/ui";
import { Composer, type Prefill } from "@/components/messages/Composer";
import { ConversationHeader } from "@/components/messages/ConversationHeader";
import { MessageBubble, PendingBubble } from "@/components/messages/MessageBubble";
import type { History, Opener, PendingMessage, RealtimeEvent, SendPayload } from "@/components/messages/types";
import { useConversation, useRealtime } from "@/components/messages/useConversation";

/** M02 Conversation: verified header, cursor-paginated history, realtime with polling fallback, member-controlled composer. */
export default function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  return (
    <AppShell>
      <Suspense fallback={<Skeleton lines={6} label="Loading conversation" />}>
        <ConversationInner id={conversationId} />
      </Suspense>
    </AppShell>
  );
}

function ConversationInner({ id }: { id: string }) {
  const { me } = useRequireMember();
  const qc = useQueryClient();
  const search = useSearchParams();
  const prefill = useMemo<Prefill>(() => {
    const text = search.get("prefill");
    if (!text) return null;
    return { text, translation_id: search.get("translation_id") ?? undefined, source_lang: search.get("source_lang") ?? undefined };
  }, [search]);

  const summary = useConversation(me ? id : "");
  const conv = summary.data;
  const ended = !!conv && conv.status !== "active";
  const onHold = !!conv && (conv.status === "safety_hold" || conv.safety_hold);

  const onEvent = useCallback(
    (e: RealtimeEvent) => {
      if (e.type === "conversation.message.created" && "conversation_id" in e && e.conversation_id === id) {
        const msg = (e as { message: Message }).message;
        qc.setQueryData<History>(["messages", id], (old) => (old ? { ...old, items: mergeMessages(old.items, [msg]) } : old));
        qc.invalidateQueries({ queryKey: ["conversations"] });
      } else if (e.type === "conversation.closed" && "conversation_id" in e && e.conversation_id === id) {
        qc.invalidateQueries({ queryKey: ["conversation", id] });
        qc.invalidateQueries({ queryKey: ["conversations"] });
      } else if (e.type === "date_plan.updated") {
        qc.invalidateQueries({ queryKey: ["conversation", id] });
        qc.invalidateQueries({ queryKey: ["date-plans"] });
        qc.invalidateQueries({ queryKey: ["date-plan"] });
      } else if (e.type === "introduction.updated") {
        qc.invalidateQueries({ queryKey: ["introductions"] });
      }
    },
    [id, qc],
  );
  const { connected } = useRealtime(onEvent, !!me);

  const history = useQuery({ queryKey: ["messages", id], queryFn: () => get<History>(`/conversations/${id}/messages`), enabled: !!me, refetchInterval: connected ? false : 8_000 });
  const [earlier, setEarlier] = useState<{ items: Message[]; next_cursor: number | null } | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [sendError, setSendError] = useState<ApiError | null>(null);

  const messages = useMemo(() => mergeMessages(earlier?.items ?? [], history.data?.items ?? []), [earlier, history.data]);

  /**
   * Things to actually say, for a conversation nobody has spoken in yet.
   *
   * Only fetched while the thread is empty: after the first message there is a conversation to
   * continue, and still offering openers would be suggesting the two of them ignore each other.
   */
  const empty = !history.isLoading && messages.length === 0 && pending.length === 0;
  const openers = useQuery({
    queryKey: ["openers", id],
    queryFn: () => get<{ items: Opener[] }>(`/conversations/${id}/openers`),
    enabled: !!me && empty,
  });
  const [replyingTo, setReplyingTo] = useState<Opener | null>(null);
  const nextCursor = earlier ? earlier.next_cursor : (history.data?.next_cursor ?? null);

  const loadEarlier = async () => {
    if (!nextCursor) return;
    setLoadingEarlier(true);
    setEarlierError(null);
    try {
      const page = await get<History>(`/conversations/${id}/messages?cursor=${nextCursor}&limit=50`);
      setEarlier((prev) => ({ items: mergeMessages(page.items, prev?.items ?? []), next_cursor: page.next_cursor }));
    } catch (e) {
      setEarlierError(e as ApiError);
    } finally {
      setLoadingEarlier(false);
    }
  };

  // Read receipt: after the newest message is on screen, tell the server how far we have read.
  const lastRead = useRef(0);
  const maxSeq = messages.length ? messages[messages.length - 1].sequence : 0;
  useEffect(() => {
    if (!me || !maxSeq || maxSeq <= lastRead.current) return;
    lastRead.current = maxSeq;
    post(`/conversations/${id}/read`, { sequence: maxSeq })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["conversations"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .catch(() => {
        /* best effort */
      });
  }, [id, maxSeq, me, qc]);

  // Keep the newest message in view when something new arrives (not when older history is prepended).
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId, pending.length]);

  const send = useCallback(
    async (p: SendPayload) => {
      setSendError(null);
      // The server validates the key against what they actually wrote and stores the answer with
      // the message, so the quote can neither be forged nor change when they edit the prompt.
      if (replyingTo) p = { ...p, prompt_key: replyingTo.key };
      setReplyingTo(null);
      setPending((prev) => [...prev.filter((x) => x.client_message_id !== p.client_message_id), { client_message_id: p.client_message_id, text: p.text, state: "sending", translation_id: p.translation_id, source_lang: p.source_lang }]);
      try {
        const msg = await post<Message>(`/conversations/${id}/messages`, p);
        qc.setQueryData<History>(["messages", id], (old) => (old ? { ...old, items: mergeMessages(old.items, [msg]) } : { items: [msg], next_cursor: null, has_more: false }));
        setPending((prev) => prev.filter((x) => x.client_message_id !== p.client_message_id));
        qc.invalidateQueries({ queryKey: ["conversations"] });
      } catch (e) {
        const err = e as ApiError;
        setSendError(err);
        if (err.code === "SAFETY_HOLD" || err.code === "CONFLICT") qc.invalidateQueries({ queryKey: ["conversation", id] });
        setPending((prev) => prev.map((x) => (x.client_message_id === p.client_message_id ? { ...x, state: "failed", error: shortError(err) } : x)));
      }
    },
    [id, qc],
  );

  if (summary.isLoading || (history.isLoading && !history.data)) return <Skeleton lines={6} label="Loading conversation" />;
  if (summary.isError) return <ErrorState error={summary.error as ApiError} retry={() => summary.refetch()} />;
  if (!conv) return null;

  const retryAfter = sendError ? (sendError.body as { retry_after?: number }).retry_after : undefined;

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <ConversationHeader conversation={conv} active="chat" />
      {onHold && <StatusBanner type="caution" title="Paused while our safety team reviews a report" body="Nothing here is a verdict about you. Messaging resumes or closes when the review ends. Safety tools stay available." action={<LinkButton href="/safety" variant="secondary">Open Safety Center</LinkButton>} />}
      {ended && !onHold && <StatusBanner type="info" title="This conversation has ended" body={conv.public_reason ?? "You can keep using the app as usual."} action={<LinkButton href="/safety" variant="secondary">Safety Center</LinkButton>} />}
      {sendError && sendError.code === "RATE_LIMITED" && <StatusBanner type="caution" title="You're sending very quickly" body={`Take a short break${retryAfter ? ` (about ${Math.ceil(retryAfter / 60)} min)` : ""}. Your unsent message is kept below.`} />}
      {sendError && sendError.code === "SAFETY_HOLD" && <StatusBanner type="caution" title="This conversation is paused for a safety review" body="Your message was not sent. Safety and account tools still work." />}
      {sendError && sendError.code === "CONFLICT" && <StatusBanner type="info" title="This conversation has ended" body="Your message was not sent." />}
      {sendError && !["RATE_LIMITED", "SAFETY_HOLD", "CONFLICT", "OFFLINE"].includes(sendError.code) && <ErrorState error={sendError} />}
      {!connected && !ended && <p className="mb-2 text-center text-xs text-ink-tertiary">Live updates paused · checking for new messages every few seconds</p>}

      <div className="flex-1">
        {nextCursor && (
          <div className="mb-3 text-center">
            <Button size="sm" variant="secondary" loading={loadingEarlier} onClick={loadEarlier}>
              Load earlier messages
            </Button>
          </div>
        )}
        <ErrorState error={earlierError} retry={loadEarlier} />
        {history.isError && <ErrorState error={history.error as ApiError} retry={() => history.refetch()} />}
        {/* The blank box is where most conversations die, and "hey" is what anybody writes when
            there is nothing specific to answer. This used to *say* their prompt answers were a
            good place to start without showing any of them. */}
        {empty && (
          <div className="rounded-[var(--radius-xl)] border border-dashed border-border bg-surface p-6">
            <p className="display text-xl font-bold text-ink">You both said yes.</p>
            <p className="mt-1 text-sm text-ink-secondary">
              {(openers.data?.items?.length ?? 0) > 0
                ? "Their words, not ours. Pick one to answer — or ignore all of it and write your own."
                : "Say hello when you're ready. The AI Wingman can offer an editable draft; nothing is sent without you."}
            </p>
            {(openers.data?.items?.length ?? 0) > 0 && (
              <ul className="mt-4 space-y-2">
                {openers.data?.items?.map((o) => (
                  <li key={o.key}>
                    <button
                      type="button"
                      aria-pressed={replyingTo?.key === o.key}
                      onClick={() => setReplyingTo(replyingTo?.key === o.key ? null : o)}
                      className={cx(
                        "w-full rounded-[var(--radius-lg)] border p-3 text-left transition-colors",
                        replyingTo?.key === o.key ? "border-action bg-action-soft" : "border-border bg-surface hover:bg-surface-muted",
                      )}
                    >
                      <span className="block text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-context">{o.label}</span>
                      <span className="mt-0.5 block text-ink">{o.answer}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ul className="space-y-2" aria-live="polite" aria-label="Messages">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {pending.map((p) => (
            <PendingBubble key={p.client_message_id} pending={p} onRetry={() => send({ client_message_id: p.client_message_id, text: p.text, translation_id: p.translation_id, source_lang: p.source_lang })} onDiscard={() => setPending((prev) => prev.filter((x) => x.client_message_id !== p.client_message_id))} />
          ))}
        </ul>
        <div ref={endRef} />
      </div>

      <Composer disabled={ended} disabledReason={onHold ? "Messaging is paused during the safety review." : "This conversation has ended."} prefill={prefill} onSend={send} />
    </div>
  );
}

function mergeMessages(a: Message[], b: Message[]) {
  const map = new Map<string, Message>();
  for (const m of [...a, ...b]) map.set(m.id, m);
  return Array.from(map.values()).sort((x, y) => x.sequence - y.sequence);
}

function shortError(err: ApiError) {
  const map: Record<string, string> = { OFFLINE: "offline", RATE_LIMITED: "sending too fast", SAFETY_HOLD: "paused for safety review", CONFLICT: "conversation ended", VALIDATION_ERROR: "check the length" };
  return map[err.code] ?? "try again";
}
