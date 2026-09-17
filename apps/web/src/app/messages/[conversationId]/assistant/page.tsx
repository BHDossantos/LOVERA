"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, newIdempotencyKey, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import type { Message } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, ErrorState, Field, LinkButton, Select, Skeleton, StatusBanner, TextArea } from "@/components/ui";
import { ConversationHeader } from "@/components/messages/ConversationHeader";
import { GOALS, TONES, TRANSLATION_LANGS, type Draft, type TranslationLang } from "@/components/messages/types";
import { useConversation } from "@/components/messages/useConversation";
import { LANG_LABEL } from "@/lib/format";

type Tone = (typeof TONES)[number]["value"];
type Goal = (typeof GOALS)[number]["value"];

/** M03 AI Wingman: tone and goal choices, an editable draft with provenance, and a separate explicit send. Never auto-sends. */
export default function AssistantPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: id } = use(params);
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const summary = useConversation(me ? id : "");
  const conv = summary.data;

  const [tone, setTone] = useState<Tone>("natural");
  const [goal, setGoal] = useState<Goal>("respond");
  const [language, setLanguage] = useState<TranslationLang>(() => (me && (TRANSLATION_LANGS as readonly string[]).includes(me.locale) ? (me.locale as TranslationLang) : "en"));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  // One client id per draft so a retried send never duplicates the message.
  const [clientId, setClientId] = useState(() => newIdempotencyKey());
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const generate = async () => {
    setDrafting(true);
    setError(null);
    try {
      const d = await post<Draft>(`/conversations/${id}/ai-drafts`, { mode: tone, goal, language });
      setDraft(d);
      setText(d.text);
      setClientId(newIdempotencyKey());
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    if (!draft || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await post<Message>(`/conversations/${id}/messages`, { client_message_id: clientId, text: text.trim(), draft_id: draft.draft_id });
      qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/messages/${id}`);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSending(false);
    }
  };

  const ended = !!conv && conv.status !== "active";
  const paywall = error?.code === "FORBIDDEN" && !!error.body.capability;
  const aiDown = error?.code === "AI_UNAVAILABLE";

  return (
    <AppShell>
      {summary.isLoading && <Skeleton lines={5} label="Loading" />}
      {summary.isError && <ErrorState error={summary.error as ApiError} retry={() => summary.refetch()} />}
      {conv && (
        <>
          <ConversationHeader conversation={conv} active="assistant" />
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">The Wingman drafts from your recent messages and their own prompt answers. It never invents experiences, never pressures, and never sends anything. You edit, you send.</p>
            {ended && <StatusBanner type="info" title="This conversation has ended" body="Drafting is off. Safety and account tools still work." action={<LinkButton href={`/messages/${id}`} variant="secondary">Back to the conversation</LinkButton>} />}
            {paywall && (
              <Card className="border-context">
                <p className="font-semibold text-ink">The AI Wingman is part of Matchmaker Pro</p>
                <p className="mt-1 text-sm text-ink-secondary">Manual messaging is always free. If you'd like editable drafts and translations, see the plans.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <LinkButton href="/you/membership">See membership</LinkButton>
                  <LinkButton href={`/messages/${id}`} variant="secondary">
                    Write it myself
                  </LinkButton>
                </div>
              </Card>
            )}
            {aiDown && (
              <StatusBanner type="caution" title="The writing assistant is unavailable right now" body={<>{error?.message} Your own words always work. Try: mention something specific from their prompts, then ask one open question.</>} action={<LinkButton href={`/messages/${id}`} variant="secondary">Back to the composer</LinkButton>} />
            )}
            {error && !paywall && !aiDown && <ErrorState error={error} retry={draft ? undefined : generate} />}

            {!ended && !paywall && (
              <>
                <fieldset>
                  <legend className="mb-2 font-semibold text-ink">What do you want to do?</legend>
                  <div role="radiogroup" aria-label="Goal" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {GOALS.map((g) => (
                      <ChoiceCard key={g.value} name="goal" title={g.label} body={g.body} selected={goal === g.value} onSelect={() => setGoal(g.value)} disabled={drafting || sending} />
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 font-semibold text-ink">Tone</legend>
                  <div role="radiogroup" aria-label="Tone" className="grid grid-cols-2 gap-2">
                    {TONES.map((t) => (
                      <ChoiceCard key={t.value} name="tone" title={t.label} body={t.body} selected={tone === t.value} onSelect={() => setTone(t.value)} disabled={drafting || sending} />
                    ))}
                  </div>
                </fieldset>
                <Field label="Language" htmlFor="language">
                  <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value as TranslationLang)} disabled={drafting || sending}>
                    {TRANSLATION_LANGS.map((l) => (
                      <option key={l} value={l}>
                        {LANG_LABEL[l]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button variant={draft ? "secondary" : "primary"} fullWidth loading={drafting} disabled={sending} onClick={generate}>
                  {draft ? "Draft another version" : "Draft a message for me to edit"}
                </Button>
              </>
            )}

            {draft && !ended && (
              <Card as="section" aria-labelledby="draft-title">
                <h2 id="draft-title" className="font-semibold text-ink">
                  Your draft (edit freely)
                </h2>
                <p className="mt-1 text-xs text-ink-tertiary">{draft.provenance}</p>
                <label htmlFor="draft-text" className="sr-only">
                  Draft text
                </label>
                <TextArea id="draft-text" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} className="mt-3" disabled={sending} />
                <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-tertiary">
                  <div className="flex gap-1">
                    <dt>Model</dt>
                    <dd className="font-mono">{draft.model_version}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>Safety check</dt>
                    <dd>{draft.safety_labels.length ? draft.safety_labels.join(", ") : "passed"}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>Review</dt>
                    <dd>{draft.requires_member_review ? "required, by you" : "n/a"}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>Auto-send</dt>
                    <dd>{draft.can_auto_send ? "yes" : "never"}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-sm text-ink-secondary">Sent messages written with help carry a small "AI-assisted" mark for honesty. The words are yours once you press send.</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button fullWidth loading={sending} disabled={!text.trim() || drafting} onClick={send}>
                    Send this message
                  </Button>
                  <Button fullWidth variant="ghost" disabled={sending} onClick={() => router.push(`/messages/${id}`)}>
                    Discard
                  </Button>
                </div>
              </Card>
            )}
            {!draft && !ended && !paywall && (
              <p className="text-center text-sm text-ink-tertiary">
                Prefer your own words?{" "}
                <Link href={`/messages/${id}`} className="font-semibold text-action">
                  Back to the conversation
                </Link>
              </p>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
