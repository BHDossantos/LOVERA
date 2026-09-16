"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { OnboardingShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, ErrorState, Field, PageTitle, StatusBanner, TextArea, TextInput, TierSelect } from "@/components/ui";

type Option = { value: string; label: string };
type Question = { key: string; phase: string; category: string; prompt: string; help: string; input: string; options: Option[]; skippable: boolean; special_category: boolean; tier_choice: boolean; preference_key: string | null; preference_label: string | null; preference_options: Option[] | null; data_use: string };
type SessionState = { session_id: string; status: string; progress: number; next_question: Question | null; review_ready: boolean; estimated_minutes_remaining: number };

/** O05 Adaptive Dating Blueprint: one scenario at a time, natural answers, skip, progress. */
export default function Interview() {
  useRequireMember({ allowOnboarding: true });
  const router = useRouter();
  const [state, setState] = useState<SessionState | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"choice" | "text">("choice");
  const [tier, setTier] = useState("prefer");
  const [partner, setPartner] = useState<string[]>([]);
  const [range, setRange] = useState({ min: 27, max: 42 });
  const [km, setKm] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    post<SessionState>("/blueprint/sessions", { mode: "initial" }).then(setState).catch((e) => setError(e as ApiError));
    setVoiceSupported(typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window));
  }, []);

  const q = state?.next_question ?? null;

  const qKey = q?.key;
  const qPreference = q?.preference_key;
  useEffect(() => {
    setChoice(null);
    setText("");
    setMode("choice");
    setPartner([]);
    if (qPreference) setTier(qKey === "children" || qKey === "relationship_structure" ? "must" : "prefer");
  }, [qKey, qPreference]);

  const submit = async (skip = false) => {
    if (!state || !q) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { question_key: q.key, skip, input_mode: mode === "text" ? "text" : "choice" };
      if (!skip) {
        if (q.input === "range") payload.range = range;
        else if (q.input === "number") payload.range = { value: km };
        else if (mode === "text") payload.text = text;
        else payload.choice = choice;
        if (q.preference_key) {
          payload.tier = tier;
          payload.partner_values = partner.length ? partner : choice ? [choice] : [];
        }
      }
      const next = await post<SessionState>(`/blueprint/sessions/${state.session_id}/answers`, payload);
      setState(next);
      if (!next.next_question) router.push(`/onboarding/blueprint/review?session=${state.session_id}`);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const listen = () => {
    type Recognizer = { lang: string; onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null; onend: (() => void) | null; start: () => void };
    const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-GB";
    rec.onresult = (e) => {
      setText((t) => `${t} ${e.results[0][0].transcript}`.trim());
      setMode("text");
    };
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  const canSubmit = !q ? false : q.input === "range" || q.input === "number" ? true : mode === "text" ? text.trim().length >= 8 : !!choice;
  const step = q?.phase === "non_negotiable" ? 4 : 4;

  return (
    <OnboardingShell step={step}>
      <PageTitle eyebrow={q ? (q.phase === "non_negotiable" ? "Non-negotiables" : "Scenario") : "Dating Blueprint"} title={q ? q.prompt : "Building your Blueprint"} lede={q?.help} />
      <ErrorState error={error} retry={() => setError(null)} />
      {state && (
        <div className="mb-4 flex items-center justify-between text-sm text-ink-secondary">
          <span>{Math.round(state.progress * 100)}% · about {state.estimated_minutes_remaining} min left</span>
          {q && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">{q.data_use === "matching_only" ? "Matching only" : "Sensitive · explicit consent"}</span>}
        </div>
      )}
      {!q && !error && <Card>Preparing your next question…</Card>}
      {q && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          {q.special_category && <StatusBanner type="caution" title="Optional sensitive question" body="Answer only if you want faith used for matching. Skipping is never held against you." />}
          {(q.input === "choice" || q.input === "choice_or_text") && mode === "choice" && (
            <div role="radiogroup" aria-label={q.prompt} className="space-y-2">
              {q.options.map((o) => (
                <ChoiceCard key={o.value} title={o.label} selected={choice === o.value} onSelect={() => setChoice(o.value)} />
              ))}
            </div>
          )}
          {q.input === "choice_or_text" && (
            <div className="mt-3">
              {mode === "choice" ? (
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setMode("text")}>
                    Answer in my own words
                  </Button>
                  {voiceSupported && (
                    <Button type="button" variant="ghost" onClick={listen} loading={listening}>
                      🎤 Speak
                    </Button>
                  )}
                </div>
              ) : (
                <Card>
                  <Field label="In your own words" htmlFor="text" help="AI turns this into signals you'll confirm. Say as much or as little as you like.">
                    <TextArea id="text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={() => setMode("choice")}>
                      Choose an option instead
                    </Button>
                    {voiceSupported && (
                      <Button type="button" variant="ghost" onClick={listen} loading={listening}>
                        🎤 Speak
                      </Button>
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}
          {q.input === "range" && (
            <Card>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="min">
                  <TextInput id="min" type="number" min={18} max={99} value={range.min} onChange={(e) => setRange({ ...range, min: Number(e.target.value) })} />
                </Field>
                <Field label="To" htmlFor="max">
                  <TextInput id="max" type="number" min={18} max={99} value={range.max} onChange={(e) => setRange({ ...range, max: Number(e.target.value) })} />
                </Field>
              </div>
            </Card>
          )}
          {q.input === "number" && (
            <Card>
              <Field label="Kilometres" htmlFor="km">
                <TextInput id="km" type="number" min={1} max={200} value={km} onChange={(e) => setKm(Number(e.target.value))} />
              </Field>
            </Card>
          )}
          {q.preference_key && q.preference_options && (
            <Card className="mt-4">
              <h2 className="mb-1 font-bold">In a partner: {q.preference_label}</h2>
              <p className="mb-3 text-sm text-ink-secondary">Which answers could you build a life with? Then decide how hard this is.</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {q.preference_options.map((o) => {
                  const on = partner.includes(o.value);
                  return (
                    <button key={o.value} type="button" aria-pressed={on} onClick={() => setPartner(on ? partner.filter((p) => p !== o.value) : [...partner, o.value])} className={`rounded-full border px-3 py-2 text-sm font-semibold ${on ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary"}`}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
              {q.tier_choice && <TierSelect value={tier} onChange={setTier} />}
              {tier === "must" && <p className="mt-2 text-sm text-ink-tertiary">Must means we never introduce anyone outside these answers, and we never relax it for you.</p>}
            </Card>
          )}
          {q.preference_key && !q.preference_options && q.input !== "range" && q.input !== "number" && null}
          {(q.input === "range" || q.input === "number") && (
            <Card className="mt-4">
              <h2 className="mb-2 font-bold">How hard is this?</h2>
              <TierSelect value={tier} onChange={setTier} />
            </Card>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <Button type="submit" fullWidth loading={busy} disabled={!canSubmit}>
              {q.phase === "non_negotiable" ? "Save and continue" : "That's me"}
            </Button>
            {q.skippable && (
              <Button type="button" variant="ghost" fullWidth onClick={() => submit(true)} disabled={busy}>
                Skip this question
              </Button>
            )}
            {state?.review_ready && (
              <Button type="button" variant="secondary" fullWidth onClick={() => router.push(`/onboarding/blueprint/review?session=${state.session_id}`)}>
                I've said enough, review my Blueprint
              </Button>
            )}
          </div>
        </form>
      )}
    </OnboardingShell>
  );
}
