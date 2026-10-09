"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, EvidenceLabel, LinkButton, PageTitle, Select, Skeleton, StatusBanner, TierPill } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { Strength } from "@/lib/types";

/**
 * `correctable` is false for a special-category signal whose consent was withdrawn: the row is
 * still returned, because a member is entitled to see what we hold, but `correct_signal` refuses
 * to change it. Offering the editor anyway meant every save came back 403.
 */
type Signal = { key: string; category: string; label: string; value: string | null; value_label: string; confidence: Strength; evidence: string | null; member_corrected: boolean; freshness_at: string | null; special_category: boolean; correctable: boolean; options: { value: string; label: string }[] };
/**
 * `current_payload` forwards the same preference objects the Preferences page gets, `active`
 * included. Typing it without that field meant this summary kept calling a withdrawn-consent faith
 * criterion a Must while the Preferences page, one tap away, correctly said it was not in use —
 * and `build_snapshot` was applying neither.
 */
type Pref = { key: string; label: string; tier: string; active?: boolean };
type Blueprint = {
  version: { id: string; version_no: number; confirmed_at: string | null; model_version: string } | null;
  signals: Signal[];
  preferences: Pref[];
  coverage: Record<string, number>;
  freshness: { age_days: number | null; stale: boolean; refresh_after_days: number };
  data_use: string;
};

const CATEGORY_LABEL: Record<string, string> = { life_plan: "Life plan", daily: "Daily life", values: "Values", interaction: "How you connect", readiness: "Readiness", logistics: "Logistics" };

/** Y02 Dating Blueprint: categories, freshness, coverage, every inference with evidence and last-updated; free to correct, paid adaptive refresh. */
export default function BlueprintPage() {
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["blueprint"], queryFn: () => get<Blueprint>("/blueprint/current"), enabled: !!me });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const canRefresh = me?.capabilities.entitlements.adaptive_refresh ?? false;

  const correct = async (key: string) => {
    if (!draft) return;
    setBusy(key);
    setError(null);
    try {
      const next = await post<Blueprint>(`/blueprint/signals/${key}`, { tier: "open", value: { value: draft } });
      qc.setQueryData(["blueprint"], next);
      qc.invalidateQueries({ queryKey: ["preferences"] });
      setEditing(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy("refresh");
    setError(null);
    try {
      await post("/blueprint/sessions", { mode: "refresh" });
      router.push("/onboarding/blueprint/interview");
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const b = q.data;
  const grouped = (b?.signals ?? []).reduce<Record<string, Signal[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <AppShell>
      <PageTitle eyebrow="You · Dating Blueprint" title="What the matchmaker believes about you" lede="Every inference shows where it came from, how sure we are, and when it was last updated. Correct anything; matching recalculates after you save." />
      {q.isLoading && <Skeleton lines={6} label="Loading your Blueprint" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      <ErrorState error={error} />
      {b && !b.version && <EmptyState title="No confirmed Blueprint yet" body="The Blueprint is built from a short scenario interview, then confirmed by you." action={<LinkButton href="/onboarding/blueprint/interview">Start the Blueprint interview</LinkButton>} />}
      {b && b.version && (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-bold">Version {b.version.version_no}</h2>
                <p className="text-sm text-ink-secondary">Confirmed {formatDate(b.version.confirmed_at)} · {b.freshness.age_days ?? 0} days old</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.freshness.stale ? "bg-context-soft text-context" : "bg-success-soft text-success"}`}>{b.freshness.stale ? "⚠ Worth refreshing" : "✓ Fresh"}</span>
            </div>
            <p className="mt-2 text-sm text-ink-secondary">We suggest a refresh after {b.freshness.refresh_after_days} days or whenever life changes. {b.data_use}</p>
            <h3 className="mt-4 text-sm font-semibold">Signal coverage</h3>
            <ul className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(b.coverage).map(([cat, n]) => (
                <li key={cat} className="rounded-[var(--radius-md)] bg-surface-muted p-2 text-sm">
                  <span className="block text-ink-secondary">{CATEGORY_LABEL[cat] ?? cat}</span>
                  <span className="font-semibold text-ink">
                    {n} signal{n === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Adaptive refresh</h2>
            <p className="mb-3 text-sm text-ink-secondary">A short follow-up interview that asks only about what may have changed. Editing every signal below is always free.</p>
            {canRefresh ? (
              <Button loading={busy === "refresh"} onClick={refresh}>
                Start a refresh interview
              </Button>
            ) : (
              <StatusBanner type="info" title="Part of Matchmaker Pro" body="Free members can still correct any inference on this page." action={<LinkButton href="/you/membership" variant="ghost">See what membership includes</LinkButton>} />
            )}
          </Card>
          {b.preferences.length > 0 && (
            <Card className="mb-4">
              <h2 className="mb-2 font-bold">Your criteria</h2>
              <ul className="flex flex-wrap gap-2">
                {b.preferences.map((p) => (
                  <li key={p.key} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm">
                    {p.label}{" "}
                    {p.active === false ? (
                      <span className="text-xs text-ink-tertiary">not in use</span>
                    ) : (
                      <TierPill tier={p.tier} />
                    )}
                  </li>
                ))}
              </ul>
              <LinkButton href="/you/preferences" variant="ghost" className="mt-2">
                Adjust preferences
              </LinkButton>
            </Card>
          )}
          {Object.entries(grouped).map(([cat, signals]) => (
            <Card key={cat} className="mb-4">
              <h2 className="mb-2 font-bold">{CATEGORY_LABEL[cat] ?? cat}</h2>
              <ul className="divide-y divide-border">
                {signals.map((s) => (
                  <li key={s.key} className="py-3">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{s.label}</span>
                      <EvidenceLabel strength={s.confidence} />
                    </div>
                    <p className="text-ink">{s.value_label || s.value || "Not set"}</p>
                    <p className="text-xs text-ink-tertiary">
                      Source: {s.member_corrected ? "corrected by you" : "interview"} · Updated {formatDate(s.freshness_at)}
                      {s.special_category ? " · sensitive category, used only with your explicit consent" : ""}
                    </p>
                    {s.evidence && <p className="mt-1 text-sm italic text-ink-secondary">“{s.evidence}”</p>}
                    {editing === s.key ? (
                      <div className="mt-2 flex gap-2">
                        <Select aria-label={`${s.label} value`} value={draft} onChange={(e) => setDraft(e.target.value)}>
                          <option value="">Choose…</option>
                          {s.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                        <Button size="sm" loading={busy === s.key} disabled={!draft} onClick={() => correct(s.key)}>
                          Save correction
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : s.correctable === false ? (
                      <p className="mt-1 text-sm text-ink-secondary">
                        You withdrew consent for sensitive data, so this is no longer used for matching and cannot be
                        changed here. Granting that consent again in <a className="underline" href="/you/privacy">Privacy</a> makes it
                        editable.
                      </p>
                    ) : (
                      <Button size="sm" variant="ghost" className="mt-1" onClick={() => { setEditing(s.key); setDraft(s.value ?? ""); }}>
                        Correct this
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </>
      )}
    </AppShell>
  );
}
