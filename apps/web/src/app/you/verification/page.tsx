"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, KeyValue, PageTitle, Skeleton, StatusBanner, TextArea, VerificationBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";

type Status = { status: string; mode: string; verified_at: string | null; expires_at: string | null; age_over_18: boolean | null; liveness_passed: boolean | null; failure_reason_code: string | null; badges: { key: string; label: string; limits: string }[] };
type SessionOut = { session: { hosted_url: string } | null; status: string; message?: string };

const STATUS_LABEL: Record<string, string> = { not_started: "Not started", in_progress: "In progress", verified: "Verified", failed: "Didn't pass", review_required: "Human review requested", expired: "Expired" };

/**
 * Where there is no identity vendor (`MM_IDENTITY_PROVIDER=manual_review`), a person does every
 * check from the admin queue, so this screen must not describe documents sitting with a vendor that
 * does not exist.
 */
const MANUAL = "manual_review";

/** Y05 Verification center: status, expiry, what each badge means and doesn't, re-verification and human review. */
export default function VerificationCenterPage() {
  const { me } = useRequireMember();
  const router = useRouter();
  const q = useQuery({ queryKey: ["verification"], queryFn: () => get<Status>("/verification/status"), enabled: !!me });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState("");

  const start = async () => {
    setBusy("start");
    setError(null);
    try {
      const s = await post<SessionOut>("/verification/sessions");
      if (s.session) router.push(s.session.hosted_url);
      else q.refetch();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };
  const review = async () => {
    setBusy("review");
    setError(null);
    try {
      await post("/verification/review-request", { note });
      q.refetch();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const s = q.data;
  const st = s?.status ?? "not_started";
  const expiringSoon = s?.expires_at ? new Date(s.expires_at).getTime() - Date.now() < 30 * 86_400_000 : false;
  return (
    <AppShell>
      <PageTitle eyebrow="You · Verification" title="Verification center" lede="Verification keeps fakes and minors out of the pool. It is not a background check and never a guarantee of character; the limits sit beside every badge." />
      {q.isLoading && <Skeleton lines={5} label="Loading verification status" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      <ErrorState error={error} />
      {s && (
        <>
          <Card className="mb-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Status</h2>
              <VerificationBadge verified={st === "verified"} />
            </div>
            <KeyValue
              items={[
                { k: "Current state", v: STATUS_LABEL[st] ?? st },
                { k: "Verified on", v: s.verified_at ? formatDate(s.verified_at) : "—" },
                { k: "Expires", v: s.expires_at ? formatDate(s.expires_at) : "—" },
                { k: "Over 18", v: s.age_over_18 === null ? "—" : s.age_over_18 ? "Confirmed" : "Not confirmed" },
                { k: "Liveness", v: s.liveness_passed === null ? "—" : s.liveness_passed ? "Passed" : "Not passed" },
              ]}
            />
          </Card>
          {st === "verified" && expiringSoon && <StatusBanner type="caution" title="Your verification expires soon" body="Re-verify to keep receiving introductions without interruption." />}
          {st === "failed" && <StatusBanner type="caution" title="Automated verification didn't pass" body={`Reason code: ${s.failure_reason_code ?? "unknown"}. You can retry or ask a person to review.`} />}
          {st === "review_required" && <StatusBanner type="info" title="A human reviewer will look at your verification" body="Acknowledgment within 24 hours. Matching score and messages are never part of that review." />}
          {st === "expired" && <StatusBanner type="caution" title="Your verification has expired" body="Introductions pause until you re-verify. Conversations and safety tools keep working." />}
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">What each badge means</h2>
            {s.badges.length === 0 && <p className="text-sm text-ink-secondary">No badges yet. Once verified you'll carry “Identity checked” and “18+”, each with its limits stated.</p>}
            <ul className="divide-y divide-border">
              {s.badges.map((b) => (
                <li key={b.key} className="py-2">
                  <span className="font-semibold text-ink">✓ {b.label}</span>
                  <p className="text-sm text-ink-secondary">{b.limits}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-tertiary">{s.mode === MANUAL ? "A member of our team does this check personally. We keep a result, an over-18 result, who decided it and the dates — no documents and no biometrics." : "Raw documents and biometrics stay with the vendor. We keep a result, an over-18 result, a reference token and dates."}</p>
          </Card>
          {st !== "review_required" && (
            <Button fullWidth loading={busy === "start"} onClick={start}>
              {s.mode === MANUAL ? (st === "verified" ? "Ask for a fresh check" : "Ask our team to verify you") : st === "verified" ? "Re-verify my identity" : st === "failed" ? "Try verification again" : st === "in_progress" ? "Continue verification" : "Begin identity and liveness verification"}
            </Button>
          )}
          {(st === "failed" || st === "in_progress" || st === "expired") && (
            <Card className="mt-4">
              <h2 className="mb-2 font-bold">Ask a person to review</h2>
              <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: what went wrong (lighting, document type…)" aria-label="Note for the reviewer" />
              <Button variant="secondary" fullWidth className="mt-3" loading={busy === "review"} onClick={review}>
                Request human review
              </Button>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}
