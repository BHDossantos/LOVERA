"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { OnboardingShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, PageTitle, StatusBanner, TextArea } from "@/components/ui";

type Status = { status: string; failure_reason_code: string | null; badges: { key: string; label: string; limits: string }[] };
type Session = { session: { provider_ref: string; hosted_url: string } | null; status: string; collects: string[]; we_keep: string[]; alternate_path: string };

/** O03 Identity verification: why, what is collected, retention, alternate review path. */
export default function Verification() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  const status = useQuery({ queryKey: ["verification"], queryFn: () => get<Status>("/verification/status"), staleTime: 0, refetchOnMount: "always", refetchInterval: (q) => (q.state.data?.status === "in_progress" ? 3000 : false) });
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState("");

  const redirected = useRef(false);
  const verified = status.data?.status === "verified";
  useEffect(() => {
    if (verified && !redirected.current) {
      redirected.current = true;
      refresh().then((m) => m && router.replace(nextOnboardingPath(m)));
    }
  }, [verified, refresh, router]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await post<Session>("/verification/sessions");
      setSession(s);
      if (s.session) router.push(s.session.hosted_url);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const requestReview = async () => {
    setBusy(true);
    try {
      await post("/verification/review-request", { note });
      status.refetch();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const s = status.data?.status ?? "not_started";
  return (
    <OnboardingShell step={2}>
      <PageTitle eyebrow="Verification" title="Prove you're a real adult, once" lede="Everyone in the introduction pool has passed the same check. It keeps fakes and minors out; it is not a background check and not a guarantee of character." />
      <ErrorState error={error} />
      {s === "failed" && <StatusBanner type="caution" title="Automated verification didn't pass" body={`Reason code: ${status.data?.failure_reason_code ?? "unknown"}. You can retry or ask a human to review.`} />}
      {s === "review_required" && <StatusBanner type="info" title="A human reviewer will look at your verification" body="Acknowledgment within 24 hours. You can keep setting up your profile meanwhile." />}
      <Card className="mb-4">
        <h2 className="mb-2 font-bold">What the vendor checks</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
          {(session?.collects ?? ["Government ID (checked by the vendor, not stored by us)", "Short liveness selfie (deleted by the vendor after the check)"]).map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <h2 className="mb-2 mt-4 font-bold">What we keep</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
          {(session?.we_keep ?? ["A verified / not verified result", "Over-18 result", "A vendor reference token", "Verification date and expiry"]).map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-tertiary">Raw documents and biometrics never reach our servers and are never used for matching.</p>
      </Card>
      {s !== "review_required" && (
        <Button fullWidth loading={busy} onClick={start}>
          {s === "failed" ? "Try verification again" : "Begin identity and liveness verification"}
        </Button>
      )}
      {(s === "failed" || s === "in_progress") && (
        <Card className="mt-4">
          <h2 className="mb-2 font-bold">Alternate path: human review</h2>
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: what went wrong (lighting, document type…)" />
          <Button variant="secondary" fullWidth className="mt-3" loading={busy} onClick={requestReview}>
            Ask a person to review
          </Button>
        </Card>
      )}
    </OnboardingShell>
  );
}
