"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, newIdempotencyKey, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, LinkButton, StatusBanner, Toggle } from "@/components/ui";
import { IntroductionHeader } from "@/components/introductions/IntroductionHeader";
import { IntroductionLoading, IntroductionUnavailable } from "@/components/introductions/IntroductionStates";
import { DECLINE_REASONS, type DecisionResult } from "@/components/introductions/types";
import { useIntroduction } from "@/components/introductions/useIntroduction";

type Choice = "accept" | "decline";

/** I04 Accept or pass: private decision, optional structured reason, learning consent, single extension. */
export default function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useIntroduction(me ? id : "");
  const intro = q.data;

  const [choice, setChoice] = useState<Choice | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  // One key per composed decision: retries after a network failure reuse it, so the server never records twice.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [result, setResult] = useState<DecisionResult | null>(null);

  const submit = async () => {
    if (!intro || !choice) return;
    setBusy(true);
    setError(null);
    setMismatch(false);
    try {
      const r = await post<DecisionResult>(`/introductions/${intro.id}/decision`, { decision: choice, reason_codes: choice === "decline" && consent ? codes : [], learning_consent: consent }, { idempotencyKey, ifMatch: intro.version });
      setResult(r);
      qc.invalidateQueries({ queryKey: ["introduction", intro.id] });
      qc.invalidateQueries({ queryKey: ["introductions"] });
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (r.status === "mutual") router.replace(`/introductions/${intro.id}/mutual`);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "VERSION_MISMATCH") {
        setMismatch(true);
        await q.refetch();
      } else if (err.code === "CONFLICT") {
        setError(err);
        await q.refetch();
      } else setError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleCode = (c: string) => setCodes((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  return (
    <AppShell>
      {q.isLoading && <IntroductionLoading />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {intro && !intro.profile && <IntroductionUnavailable passed={intro.status === "you_passed"} />}
      {intro && intro.profile && (
        <>
          <IntroductionHeader intro={intro} active="decision" showExtend />
          {result?.status === "awaiting_other_member" && <StatusBanner type="success" title="Your yes is private until they decide" body="If they also say yes, a conversation opens and we'll let you know. If not, nothing about your choice is ever shared." action={<LinkButton href="/today" variant="secondary">Back to Today</LinkButton>} />}
          {result?.status === "you_passed" && <StatusBanner type="info" title="You passed. Nothing was shared." body="A pass is never shown as a rating and does not change your visibility." action={<LinkButton href="/introductions" variant="secondary">Back to introductions</LinkButton>} />}
          {result?.status === "mutual" && <StatusBanner type="success" title="You both said yes" action={<LinkButton href={`/introductions/${intro.id}/mutual`}>See your next steps</LinkButton>} />}
          {!result && intro.status === "awaiting_other_member" && <StatusBanner type="success" title="Your yes is private until they decide" body="There is nothing more to do here. We'll tell you if it becomes mutual." />}
          {!result && intro.status === "offered" && (
            <div className="space-y-4">
              {mismatch && <StatusBanner type="caution" title="This introduction changed" body="We reloaded the latest version. Please review and confirm your decision again." />}
              <ErrorState error={error} />
              {error?.code === "FORBIDDEN" && error.body.capability && (
                <Card className="border-context">
                  <p className="font-semibold text-ink">Deciding on curated introductions is part of Matchmaker Pro</p>
                  <p className="mt-1 text-sm text-ink-secondary">Your trial introduction has been used. Safety tools, messaging after a mutual yes and manual date planning stay free.</p>
                  <LinkButton href="/you/membership" className="mt-3" variant="secondary">
                    See membership options
                  </LinkButton>
                </Card>
              )}
              <Card as="section" aria-labelledby="privacy">
                <h2 id="privacy" className="font-semibold text-ink">
                  Private either way
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">{intro.privacy} A conversation opens only if you both say yes.</p>
              </Card>
              <div role="radiogroup" aria-label="Your decision" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button type="button" role="radio" aria-checked={choice === "accept"} onClick={() => setChoice("accept")} disabled={!intro.actions.can_accept || busy} className={`min-h-14 rounded-[var(--radius-lg)] border p-4 text-left ${choice === "accept" ? "border-action bg-action-soft" : "border-border bg-surface"}`}>
                  <span className="block font-semibold text-ink">Yes, I'd like to meet</span>
                  <span className="block text-sm text-ink-secondary">Private until they decide too.</span>
                </button>
                <button type="button" role="radio" aria-checked={choice === "decline"} onClick={() => setChoice("decline")} disabled={!intro.actions.can_decline || busy} className={`min-h-14 rounded-[var(--radius-lg)] border p-4 text-left ${choice === "decline" ? "border-action bg-action-soft" : "border-border bg-surface"}`}>
                  <span className="block font-semibold text-ink">Pass</span>
                  <span className="block text-sm text-ink-secondary">Never shown to them. Never affects your visibility.</span>
                </button>
              </div>
              {choice === "decline" && (
                <Card as="section" aria-labelledby="reasons">
                  <h2 id="reasons" className="font-semibold text-ink">
                    Optional: why? (for your own matching only)
                  </h2>
                  <p className="mt-1 text-sm text-ink-secondary">Reasons are recorded only if you allow learning below. They are never shown to the other member.</p>
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {DECLINE_REASONS.map((r) => (
                      <li key={r.code}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink">
                          <input type="checkbox" className="h-5 w-5" checked={codes.includes(r.code)} onChange={() => toggleCode(r.code)} disabled={busy} />
                          {r.label}
                        </label>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {choice && (
                <Card as="section">
                  <Toggle checked={consent} onChange={setConsent} label="Let this decision improve my future introductions" description="Explicit consent only. Off by default; you can change it in privacy settings." />
                </Card>
              )}
              <Button fullWidth loading={busy} disabled={!choice || busy} onClick={submit}>
                {choice === "decline" ? "Pass privately" : "Say yes privately"}
              </Button>
              <p className="text-center text-xs text-ink-tertiary">Not sure yet? Reread the evidence, or use your one extension above. There's no penalty for taking time.</p>
            </div>
          )}
          {!result && intro.status === "mutual" && <StatusBanner type="success" title="You both said yes" action={<LinkButton href={`/introductions/${intro.id}/mutual`}>See your next steps</LinkButton>} />}
        </>
      )}
    </AppShell>
  );
}
