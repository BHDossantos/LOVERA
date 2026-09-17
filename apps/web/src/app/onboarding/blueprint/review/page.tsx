"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, get, post } from "@/lib/api";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { OnboardingShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, EvidenceLabel, PageTitle, Select, Skeleton, TierPill, TierSelect } from "@/components/ui";
import type { Strength } from "@/lib/types";

type Signal = { key: string; category: string; label: string; value: string | null; value_label: string | null; options: { value: string; label: string }[]; confidence: Strength; evidence: string | null; source: string; needs_choice: boolean; special_category: boolean };
type Pref = { key: string; label: string; tier: string; operator: string; value: Record<string, unknown>; description: string };
type Review = { session_id: string; status: string; signals: Signal[]; preferences: Pref[]; confidence_wording: Record<string, string>; note: string };

const CATEGORY_LABEL: Record<string, string> = { life_plan: "Life plan", daily: "Daily life", values: "Values", interaction: "How you connect", readiness: "Readiness", logistics: "Logistics" };

/** O06 Blueprint review: human-readable Must / Prefer / Open summary; member confirms or edits every inference. */
function ReviewInner() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session") ?? "";
  const [review, setReview] = useState<Review | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [tiers, setTiers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    post(`/blueprint/sessions/${sessionId}/finish`)
      .catch(() => null)
      .then(() => get<Review>(`/blueprint/sessions/${sessionId}/review`))
      .then(setReview)
      .catch((e) => setError(e as ApiError));
  }, [sessionId]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/blueprint/confirm", { session_id: sessionId, signal_edits: Object.entries(edits).map(([key, value]) => ({ key, value })), preference_edits: Object.entries(tiers).map(([key, tier]) => ({ key, tier })), removed_signal_keys: removed });
      const m = await refresh();
      if (m) router.replace(nextOnboardingPath(m));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (!review) {
    return (
      <OnboardingShell step={5}>
        <ErrorState error={error} />
        <Skeleton lines={6} />
      </OnboardingShell>
    );
  }
  const grouped = review.signals.reduce<Record<string, Signal[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});
  const unresolved = review.signals.filter((s) => (s.needs_choice || !s.value) && !edits[s.key] && !removed.includes(s.key));

  return (
    <OnboardingShell step={5}>
      <PageTitle eyebrow="Blueprint review" title="Here's what we understood. Correct anything." lede={review.note} />
      <ErrorState error={error} />
      <Card className="mb-4">
        <h2 className="mb-2 font-bold">Your partner criteria</h2>
        <ul className="divide-y divide-border">
          {review.preferences.map((p) => (
            <li key={p.key} className="py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">{p.label}</span>
                <TierPill tier={tiers[p.key] ?? p.tier} />
              </div>
              <p className="mb-2 text-sm text-ink-secondary">{describe(p)}</p>
              <TierSelect value={tiers[p.key] ?? p.tier} onChange={(t) => setTiers({ ...tiers, [p.key]: t })} />
            </li>
          ))}
        </ul>
      </Card>
      {Object.entries(grouped).map(([cat, signals]) => (
        <Card key={cat} className="mb-4">
          <h2 className="mb-2 font-bold">{CATEGORY_LABEL[cat] ?? cat}</h2>
          <ul className="divide-y divide-border">
            {signals.map((s) => {
              const current = edits[s.key] ?? s.value ?? "";
              const isRemoved = removed.includes(s.key);
              return (
                <li key={s.key} className={`py-3 ${isRemoved ? "opacity-50" : ""}`}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{s.label}</span>
                    <EvidenceLabel strength={edits[s.key] ? "strong" : s.confidence} />
                  </div>
                  {s.evidence && <p className="mb-2 text-sm italic text-ink-tertiary">“{s.evidence}”</p>}
                  <div className="flex gap-2">
                    <Select aria-label={`${s.label} value`} value={current} disabled={isRemoved} onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}>
                      <option value="">Choose…</option>
                      {s.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRemoved(isRemoved ? removed.filter((k) => k !== s.key) : [...removed, s.key])}>
                      {isRemoved ? "Keep" : "Leave out"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      <p className="mb-3 text-sm text-ink-tertiary">{review.confidence_wording.promising} {review.confidence_wording.low_evidence}</p>
      <Button fullWidth loading={busy} disabled={unresolved.length > 0} onClick={confirm}>
        {unresolved.length ? `Resolve ${unresolved.length} unclear item${unresolved.length > 1 ? "s" : ""} first` : "Confirm my Blueprint"}
      </Button>
      <Button variant="ghost" fullWidth className="mt-2" onClick={() => router.push("/onboarding/blueprint/interview")}>
        Answer more questions
      </Button>
    </OnboardingShell>
  );
}

function describe(p: Pref) {
  const v = p.value as { min?: number; max?: number; in?: string[] };
  if (p.key === "age_range") return `${v.min}–${v.max} years old`;
  if (p.key === "distance_km") return `Within ${v.max} km`;
  if (v.in?.length) return `Accepts: ${v.in.join(", ").replace(/_/g, " ")}`;
  return p.description;
}

export default function ReviewPage() {
  return (
    <Suspense>
      <ReviewInner />
    </Suspense>
  );
}
