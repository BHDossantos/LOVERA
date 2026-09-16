"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, ErrorState, LinkButton, PageTitle, Skeleton, StatusBanner, Toggle, cx } from "@/components/ui";
import { useDatePlan, type Outcome } from "@/components/dates/shared";

const ATTENDANCE = [
  { value: "attended", title: "We met", body: "The date happened." },
  { value: "other_no_show", title: "They didn't turn up", body: "You were there; they weren't, without a message." },
  { value: "i_cancelled", title: "I couldn't make it", body: "You cancelled or didn't go." },
  { value: "not_yet", title: "It hasn't happened yet", body: "Come back afterwards." },
];
const FIT_REASONS = ["Conversation flowed", "Shared values came through", "Similar pace of life", "Felt respected", "Different plans for the future", "Different energy", "Distance felt real", "Hard to say"];

/** D05 Private post-date feedback: no star ratings, second-date interest revealed only if mutual, safety route separate from learning. */
export default function FeedbackPage({ params }: { params: Promise<{ dateId: string }> }) {
  const { dateId } = use(params);
  useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const plan = useDatePlan(dateId);
  const [attendance, setAttendance] = useState("attended");
  const [feltSafe, setFeltSafe] = useState<boolean | null>(null);
  const [enjoyed, setEnjoyed] = useState<"yes" | "somewhat" | "no" | null>(null);
  const [second, setSecond] = useState<"yes" | "no" | "unsure" | null>(null);
  const [learning, setLearning] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [safetyFlag, setSafetyFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const met = attendance === "attended";
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post<{ saved: boolean; outcome: Outcome }>(`/date-plans/${dateId}/feedback`, { attendance, felt_safe: met ? feltSafe : null, enjoyed: met ? enjoyed : null, second_date_answer: met ? second : null, fit_reasons: learning ? reasons : [], safety_flag: safetyFlag, learning_consent: learning });
      await qc.invalidateQueries({ queryKey: ["date-plan", dateId] });
      await qc.invalidateQueries({ queryKey: ["date-plans"] });
      router.push(`/dates/${dateId}/mutual-second-date`);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const p = plan.data;
  const canSubmit = attendance !== "not_yet" && (!met || second !== null);
  return (
    <AppShell>
      <PageTitle eyebrow="Private feedback" title={p ? `How was meeting ${p.other_display_name}?` : "How did it go?"} lede="Private. No star ratings, no rejection reasons shown to anyone. A second-date yes is revealed only if you both say yes." />
      {plan.isLoading && <Skeleton lines={5} label="Loading the date" />}
      {plan.error && <ErrorState error={plan.error as ApiError} retry={() => plan.refetch()} />}
      <ErrorState error={error} />
      {p && !p.feedback_open && !p.feedback_submitted && <StatusBanner type="info" title="Feedback opens after the date starts" body="You'll find this page again from the Dates tab." action={<LinkButton href={`/dates/${p.id}`} variant="secondary">Back to the date</LinkButton>} />}
      {p && p.feedback_submitted && <StatusBanner type="info" title="You've already answered" body="Submitting again replaces your earlier private answers." />}
      {p && (
        <>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Did the date happen?</h2>
            <div role="radiogroup" aria-label="Attendance" className="space-y-2">
              {ATTENDANCE.map((a) => (
                <ChoiceCard key={a.value} title={a.title} body={a.body} selected={attendance === a.value} onSelect={() => setAttendance(a.value)} />
              ))}
            </div>
          </Card>
          {met && (
            <>
              <Card className="mb-4">
                <h2 className="mb-2 font-bold">Did you feel safe?</h2>
                <div className="flex gap-2" role="radiogroup" aria-label="Felt safe">
                  {[
                    { v: true, l: "Yes" },
                    { v: false, l: "Not entirely" },
                  ].map((o) => (
                    <button key={o.l} type="button" role="radio" aria-checked={feltSafe === o.v} onClick={() => setFeltSafe(o.v)} className={cx("flex-1 rounded-[var(--radius-md)] border px-3 py-3 font-semibold", feltSafe === o.v ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                      {o.l}
                    </button>
                  ))}
                </div>
                {feltSafe === false && <p className="mt-2 text-sm text-ink">Thank you for saying so. The safety section below is separate from matching and handled by people.</p>}
              </Card>
              <Card className="mb-4">
                <h2 className="mb-2 font-bold">Did you enjoy it?</h2>
                <div className="flex gap-2" role="radiogroup" aria-label="Enjoyed">
                  {(["yes", "somewhat", "no"] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={enjoyed === v} onClick={() => setEnjoyed(v)} className={cx("flex-1 rounded-[var(--radius-md)] border px-3 py-3 font-semibold capitalize", enjoyed === v ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                      {v}
                    </button>
                  ))}
                </div>
              </Card>
              <Card className="mb-4 border-action">
                <h2 className="mb-1 font-bold">Would you like a second date?</h2>
                <p className="mb-3 text-sm text-ink-secondary">Private. {p.other_display_name} sees nothing unless you both say yes. “Unsure” is a fine answer.</p>
                <div className="flex gap-2" role="radiogroup" aria-label="Second date">
                  {(["yes", "unsure", "no"] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={second === v} onClick={() => setSecond(v)} className={cx("flex-1 rounded-[var(--radius-md)] border px-3 py-3 font-semibold capitalize", second === v ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                      {v}
                    </button>
                  ))}
                </div>
              </Card>
              <Card className="mb-4">
                <Toggle checked={learning} onChange={setLearning} label="Help my own matching learn from this (optional)" description="Only your future introductions change. Nothing is shared with the other person or used for safety decisions. You can revoke this in Privacy." />
                {learning && (
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="What shaped your answer">
                    {FIT_REASONS.map((r) => {
                      const on = reasons.includes(r);
                      return (
                        <button key={r} type="button" aria-pressed={on} disabled={!on && reasons.length >= 5} onClick={() => setReasons(on ? reasons.filter((x) => x !== r) : [...reasons, r])} className={cx("rounded-full border px-3 py-2 text-sm font-semibold", on ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                          {r}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          )}
          <Card className="mb-4 border-caution">
            <h2 className="mb-1 font-bold">Something felt wrong?</h2>
            <p className="mb-2 text-sm text-ink-secondary">Safety concerns go to a human team, never into matching or model training. You can flag it here, and report or block privately whenever you're ready.</p>
            <Toggle checked={safetyFlag} onChange={setSafetyFlag} label="Flag a safety concern about this date" description="We'll point you to a private report. Nobody is told who raised it." />
            <LinkButton href={`/safety/report?date=${p.id}&conversation=${p.conversation_id}`} variant="secondary" className="mt-2">
              Report or block now
            </LinkButton>
          </Card>
          <Button fullWidth loading={busy} disabled={!canSubmit} onClick={submit}>
            {attendance === "not_yet" ? "Come back after the date" : met && second === null ? "Answer the second-date question first" : "Save my private answers"}
          </Button>
          <LinkButton href={`/dates/${p.id}`} variant="ghost" fullWidth className="mt-2">
            Not now
          </LinkButton>
        </>
      )}
    </AppShell>
  );
}
