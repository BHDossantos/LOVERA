"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, post } from "@/lib/api";
import { nextOnboardingPath, useAuth } from "@/lib/auth";
import { Button, Card, ErrorState, Field, TextInput } from "@/components/ui";

/** O01 Welcome + sign-in. No profiles or pricing before the member understands the outcome and method. */
export default function Welcome() {
  const { me, loading, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<{ challenge_id: string; dev_code: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!loading && me) router.replace(nextOnboardingPath(me));
  }, [me, loading, router]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post<{ challenge_id: string; dev_code: string | null }>("/auth/start", { email });
      setChallenge(data);
      if (data.dev_code) setCode(data.dev_code);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const m = await signIn(challenge.challenge_id, code);
      if (m) router.replace(nextOnboardingPath(m));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-context">Invite-only pilot · Rome</p>
        <h1 className="text-3xl font-bold leading-tight text-ink sm:text-4xl">A matchmaker, not a feed.</h1>
        <p className="mt-3 text-lg text-ink-secondary">One to three verified, reciprocal introductions a week. Each comes with three plain reasons, one honest friction, and what only a real date can tell you.</p>
        <ul className="mt-6 space-y-3 text-ink">
          {[
            ["Verified people only", "Identity and 18+ checks before anyone enters the pool. No swiping, no likes, no popularity score."],
            ["Private decisions", "Chat opens only after you both say yes. A pass is never shown to the other person."],
            ["Built around the second date", "We coordinate a safe public first date and learn from what you privately tell us afterwards."],
            ["AI assists, you speak", "Drafts and translations are suggestions. Nothing is sent as your words without you."],
          ].map(([t, b]) => (
            <li key={t} className="flex gap-3">
              <span aria-hidden className="mt-1 text-action">
                ✓
              </span>
              <span>
                <span className="font-semibold">{t}.</span> <span className="text-ink-secondary">{b}</span>
              </span>
            </li>
          ))}
        </ul>
        <Card className="mt-8">
          <h2 className="mb-1 text-lg font-bold">Start your Dating Blueprint</h2>
          <p className="mb-4 text-sm text-ink-secondary">Sign in with a one-time code. Verification and the Blueprint take about ten minutes.</p>
          <ErrorState error={error} />
          {!challenge ? (
            <form onSubmit={start}>
              <Field label="Email" htmlFor="email">
                <TextInput id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </Field>
              <Button type="submit" fullWidth loading={busy}>
                Send me a code
              </Button>
            </form>
          ) : (
            <form onSubmit={verify}>
              <Field label={`Code sent to ${email}`} htmlFor="code" help={challenge.dev_code ? "Pilot sandbox: the code is pre-filled because email delivery is simulated." : "Check your inbox. The code lasts ten minutes."}>
                <TextInput id="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Button type="submit" fullWidth loading={busy}>
                Continue
              </Button>
              <Button type="button" variant="ghost" fullWidth className="mt-2" onClick={() => setChallenge(null)}>
                Use a different email
              </Button>
            </form>
          )}
        </Card>
        <p className="mt-6 text-xs text-ink-tertiary">We never claim to predict chemistry. We screen for feasibility, explain the evidence, and learn from real dates. Safety tools are free for everyone.</p>
      </main>
    </div>
  );
}
