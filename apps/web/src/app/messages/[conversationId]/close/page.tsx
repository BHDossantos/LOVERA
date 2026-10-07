"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, ErrorState, Field, LinkButton, Skeleton, StatusBanner, TextArea, Toggle } from "@/components/ui";
import { ConversationHeader } from "@/components/messages/ConversationHeader";
import { CLOSE_REASONS, type CloseResult } from "@/components/messages/types";
import { useConversation } from "@/components/messages/useConversation";

type Reason = (typeof CLOSE_REASONS)[number]["code"];

/** M06 Respectful close: neutral end, private reason, optional block, separate safety route, consequence preview. */
export default function ClosePage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: id } = use(params);
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const summary = useConversation(me ? id : "");
  const conv = summary.data;
  const [reason, setReason] = useState<Reason>("not_for_me");
  const [note, setNote] = useState("");
  const [block, setBlock] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<CloseResult | null>(null);

  // The safety target rather than the profile id: `summary()` nulls `other.member_id` once the
  // conversation closes, which is exactly when most reports get written.
  const subjectId = conv?.safety.subject_id ?? null;
  const reportHref = subjectId ? `/safety/report?subject=${subjectId}&conversation=${id}` : `/safety/report?conversation=${id}`;
  const alreadyEnded = !!conv && conv.status !== "active";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<CloseResult>(`/conversations/${id}/close`, { reason, private_note: note.trim() || null, block });
      setDone(r);
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", id] });
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["dates"] });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      {summary.isLoading && <Skeleton lines={5} label="Loading" />}
      {summary.isError && <ErrorState error={summary.error as ApiError} retry={() => summary.refetch()} />}
      {conv && (
        <>
          <ConversationHeader conversation={conv} active="close" />
          {done ? (
            <StatusBanner type="success" title={done.blocked ? "Conversation ended and member blocked" : "Conversation ended"} body="They see only that the conversation has closed. No reason, no negotiation prompt." action={<Button onClick={() => router.replace("/messages")}>Back to Messages</Button>} />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-ink-secondary">Ending a conversation is normal. You don't owe an explanation, and the other person only sees a neutral close.</p>
              <ErrorState error={error} retry={submit} />
              <Card as="section" className="border-caution/60">
                <h2 className="font-semibold text-ink">Felt unsafe, harassed or scammed?</h2>
                <p className="mt-1 text-sm text-ink-secondary">Use the safety route instead. Reports go to the safety team, are excluded from matching, and can include evidence.</p>
                <LinkButton href={reportHref} variant="danger" className="mt-3">
                  Report to the safety team
                </LinkButton>
              </Card>
              {alreadyEnded && !block && <StatusBanner type="info" title="This conversation has already ended" body="You can still block the member below." />}
              <fieldset>
                <legend className="mb-2 font-semibold text-ink">Why are you ending it? (private)</legend>
                <div role="radiogroup" aria-label="Reason" className="space-y-2">
                  {CLOSE_REASONS.map((r) => (
                    <ChoiceCard key={r.code} name="reason" title={r.label} body={r.body} selected={reason === r.code} onSelect={() => setReason(r.code)} disabled={busy} />
                  ))}
                </div>
              </fieldset>
              {reason === "safety" && <StatusBanner type="caution" title="Safety reasons are routed to moderation" body={<>You can end the conversation here and we'll flag it for the safety team, or <Link href={reportHref} className="font-semibold text-action underline">file a full report</Link> with details and evidence.</>} />}
              <Field label="Private note (optional)" htmlFor="note" help={`Only you and, for safety reasons, the moderation team ever see this. ${note.length}/300`}>
                <TextArea id="note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
              </Field>
              <Card>
                <Toggle checked={block} onChange={setBlock} label="Also block this member" description="They can't contact you or be introduced to you again. Blocking is reversible from Safety Center." />
              </Card>
              {!confirming ? (
                <Button fullWidth variant={block ? "danger" : "primary"} disabled={busy} onClick={() => setConfirming(true)}>
                  {block ? "Review: end and block" : "Review: end this conversation"}
                </Button>
              ) : (
                <Card as="section" aria-labelledby="consequences" className="border-context">
                  <h2 id="consequences" className="font-semibold text-ink">
                    What happens next
                  </h2>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
                    <li>The conversation closes for both of you. They see only "This conversation has ended."</li>
                    <li>Any proposed or confirmed date in this conversation is cancelled.</li>
                    <li>Your reason and note stay private{reason === "safety" ? ", except to the safety team" : ""}. They are never used to describe you to anyone.</li>
                    {block ? <li>They are blocked: no contact, no future introductions. You can undo this in Safety Center.</li> : <li>Not blocked: you could be introduced again in the future only if you both qualify. You can block later from Safety Center.</li>}
                    <li>The conversation itself cannot be reopened.</li>
                  </ul>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button fullWidth variant={block ? "danger" : "primary"} loading={busy} onClick={submit}>
                      {block ? "End and block" : "End this conversation"}
                    </Button>
                    <Button fullWidth variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                      Go back
                    </Button>
                  </div>
                </Card>
              )}
              <p className="text-center text-sm">
                <Link href={`/messages/${id}`} className="font-semibold text-action">
                  Keep the conversation open
                </Link>
              </p>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
