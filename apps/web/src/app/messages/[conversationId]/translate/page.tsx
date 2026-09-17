"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { LANG_LABEL } from "@/lib/format";
import type { Message } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, Field, LinkButton, Select, Skeleton, StatusBanner, TextArea, cx } from "@/components/ui";
import { ConversationHeader } from "@/components/messages/ConversationHeader";
import { TRANSLATION_LANGS, type History, type TranslationLang, type TranslationResult } from "@/components/messages/types";
import { useConversation } from "@/components/messages/useConversation";

/** M04 Translation preview: original and translation side by side, language labels, low-confidence warning, insert for review. Never auto-sends. */
export default function TranslatePage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: id } = use(params);
  const { me } = useRequireMember();
  const router = useRouter();
  const summary = useConversation(me ? id : "");
  const conv = summary.data;
  const history = useQuery({ queryKey: ["messages", id], queryFn: () => get<History>(`/conversations/${id}/messages`), enabled: !!me });
  const received = useMemo(() => (history.data?.items ?? []).filter((m) => !m.mine && m.moderation_state !== "hidden" && m.text).slice(-8).reverse(), [history.data]);

  const myLang: TranslationLang = me && (TRANSLATION_LANGS as readonly string[]).includes(me.locale) ? (me.locale as TranslationLang) : "en";
  const theirLang: TranslationLang = (conv?.other.languages?.find((l) => (TRANSLATION_LANGS as readonly string[]).includes(l) && l !== myLang) as TranslationLang | undefined) ?? (myLang === "en" ? "it" : "en");

  const [mode, setMode] = useState<"received" | "typed">("typed");
  const [messageId, setMessageId] = useState<string>("");
  const [text, setText] = useState("");
  const [source, setSource] = useState<TranslationLang>(myLang);
  const [target, setTarget] = useState<TranslationLang>(theirLang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);

  const pickReceived = (m: Message) => {
    setMode("received");
    setMessageId(m.id);
    setSource(theirLang);
    setTarget(myLang);
    setResult(null);
  };
  const pickTyped = () => {
    setMode("typed");
    setMessageId("");
    setSource(myLang);
    setTarget(theirLang);
    setResult(null);
  };

  const translate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === "received" ? { message_id: messageId, source_lang: source, target_lang: target } : { text: text.trim(), source_lang: source, target_lang: target };
      setResult(await post<TranslationResult>(`/conversations/${id}/translations`, body));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    if (!result) return;
    const q = new URLSearchParams({ prefill: result.translated.text, translation_id: result.translation_id, source_lang: result.source.lang });
    router.push(`/messages/${id}?${q.toString()}`);
  };

  const paywall = error?.code === "FORBIDDEN" && !!error.body.capability;
  const aiDown = error?.code === "AI_UNAVAILABLE";
  const canSubmit = source !== target && (mode === "received" ? !!messageId : !!text.trim());

  return (
    <AppShell>
      {summary.isLoading && <Skeleton lines={5} label="Loading" />}
      {summary.isError && <ErrorState error={summary.error as ApiError} retry={() => summary.refetch()} />}
      {conv && (
        <>
          <ConversationHeader conversation={conv} active="translate" />
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">English, Italian, Spanish and Portuguese for now. A translation is a preview: it goes into your composer for review and is never sent on its own.</p>
            {paywall && (
              <Card className="border-context">
                <p className="font-semibold text-ink">Translation is part of Matchmaker Pro</p>
                <p className="mt-1 text-sm text-ink-secondary">Messaging in any language you share is always free.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <LinkButton href="/you/membership">See membership</LinkButton>
                  <LinkButton href={`/messages/${id}`} variant="secondary">
                    Back to the conversation
                  </LinkButton>
                </div>
              </Card>
            )}
            {aiDown && <StatusBanner type="caution" title="Translation is unavailable right now" body={error?.message} action={<LinkButton href={`/messages/${id}`} variant="secondary">Write in your own language</LinkButton>} />}
            {error && !paywall && !aiDown && <ErrorState error={error} />}

            {!paywall && (
              <form onSubmit={translate} className="space-y-4">
                <div role="radiogroup" aria-label="What to translate" className="grid grid-cols-2 gap-2">
                  <button type="button" role="radio" aria-checked={mode === "typed"} onClick={pickTyped} className={cx("min-h-11 rounded-[var(--radius-md)] border px-3 py-2 text-sm font-semibold", mode === "typed" ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                    Something I want to say
                  </button>
                  <button type="button" role="radio" aria-checked={mode === "received"} onClick={() => (received[0] ? pickReceived(received[0]) : setMode("received"))} className={cx("min-h-11 rounded-[var(--radius-md)] border px-3 py-2 text-sm font-semibold", mode === "received" ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                    A message I received
                  </button>
                </div>
                {mode === "typed" ? (
                  <Field label="Your text" htmlFor="source-text">
                    <TextArea id="source-text" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write it the way you'd say it." />
                  </Field>
                ) : (
                  <fieldset>
                    <legend className="mb-2 text-sm font-semibold text-ink">Pick a received message</legend>
                    {history.isLoading && <Skeleton lines={3} />}
                    {received.length === 0 && !history.isLoading && <p className="text-sm text-ink-secondary">No received messages yet.</p>}
                    <ul className="space-y-2" role="radiogroup" aria-label="Received messages">
                      {received.map((m) => (
                        <li key={m.id}>
                          <button type="button" role="radio" aria-checked={messageId === m.id} onClick={() => pickReceived(m)} className={cx("w-full rounded-[var(--radius-md)] border p-3 text-left text-sm", messageId === m.id ? "border-action bg-action-soft" : "border-border bg-surface")}>
                            {m.text.length > 160 ? `${m.text.slice(0, 160)}…` : m.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From" htmlFor="source-lang">
                    <Select id="source-lang" value={source} onChange={(e) => setSource(e.target.value as TranslationLang)}>
                      {TRANSLATION_LANGS.map((l) => (
                        <option key={l} value={l}>
                          {LANG_LABEL[l]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="To" htmlFor="target-lang" error={source === target ? "Choose two different languages." : undefined}>
                    <Select id="target-lang" value={target} onChange={(e) => setTarget(e.target.value as TranslationLang)}>
                      {TRANSLATION_LANGS.map((l) => (
                        <option key={l} value={l}>
                          {LANG_LABEL[l]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button type="submit" fullWidth loading={busy} disabled={!canSubmit}>
                  Preview the translation
                </Button>
              </form>
            )}

            {result && (
              <Card as="section" aria-labelledby="preview">
                <h2 id="preview" className="font-semibold text-ink">
                  Preview
                </h2>
                {result.low_confidence && <StatusBanner type="caution" title="Low confidence" body={result.note ?? "This may contain slang or idioms we're unsure about. Read it carefully and edit before sending."} />}
                {!result.low_confidence && result.note && <p className="mt-1 text-sm text-ink-secondary">{result.note}</p>}
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-[var(--radius-lg)] bg-surface-muted p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Original · {LANG_LABEL[result.source.lang] ?? result.source.lang}</p>
                    <p lang={result.source.lang} className="mt-1 whitespace-pre-wrap text-ink">
                      {result.source.text}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-lg)] border border-action bg-action-soft/40 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-action">Translation · {LANG_LABEL[result.translated.lang] ?? result.translated.lang}</p>
                    <p lang={result.translated.lang} className="mt-1 whitespace-pre-wrap text-ink">
                      {result.translated.text}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-ink-tertiary">
                  Model <span className="font-mono">{result.model_version}</span> · requires your review · auto-send: never
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button fullWidth onClick={insert}>
                    Insert into composer to review
                  </Button>
                  <Button fullWidth variant="ghost" onClick={() => setResult(null)}>
                    Discard
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
