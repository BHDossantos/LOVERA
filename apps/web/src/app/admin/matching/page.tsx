"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorState, EvidenceLabel, Modal, Select, Skeleton, StatusBanner, TextInput, cx } from "@/components/ui";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatDateTime } from "@/lib/format";
import type { Strength } from "@/lib/types";

/** One screenful of corrections. Small, because each row is read rather than skimmed. */
const CORRECTIONS_PER_PAGE = 20;

type Run = { id: string; market_id: string; cohort_date: string; status: string; rules_version: string; model_version: string; candidate_count: number; allocation_count: number; stats: Record<string, unknown>; started_at: string | null; finished_at: string | null };
type Reason = { label: string; strength: Strength; text: string };
type Pair = {
  pair_id: string;
  introduction_id: string | null;
  member_a: { id: string; name: string };
  member_b: { id: string; name: string };
  scores: Record<string, number | null>;
  penalties: Record<string, number>;
  rank_for_a: number | null;
  rank_for_b: number | null;
  review_status: string;
  review_note: string | null;
  explanations: { for: string; reasons: Reason[]; friction: { text: string; strength: Strength } | null; unknown: { text: string; strength: Strength } | null }[];
  evidence: { overlaps: number | null; distance_km: number | null; shared_languages: string[] | null };
};
/**
 * A correction a member filed against an explanation. The ones with `applied: false` are the
 * reason this queue exists: the member said an inference was wrong without supplying a
 * replacement, so nothing about their matching changed and only a person can act on it. They
 * were being told "noted for a reviewer" while no reviewer had anywhere to read them.
 */
type Correction = {
  id: string;
  introduction_id: string;
  member: { id: string; name: string };
  signal_key: string;
  signal_label: string;
  corrected_value: string | null;
  applied: boolean;
  note: string | null;
  created_at: string | null;
  review: { decision: string; note: string | null; reviewer: { id: string; name: string }; at: string | null } | null;
};

/** Concierge matching: run the weekly batch, review pairs with internal scores and explanations, publish. No safety data. */
export default function AdminMatchingPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ["admin", "matching", "runs"], queryFn: () => get<{ items: Run[] }>("/admin/matching/runs"), enabled: !!me });
  const [selected, setSelected] = useState<string | null>(null);
  const runId = selected ?? runs.data?.items[0]?.id ?? null;
  const pairs = useQuery({ queryKey: ["admin", "matching", "pairs", runId], queryFn: () => get<{ run: Run; items: Pair[] }>(`/admin/matching/runs/${runId}/pairs`), enabled: !!runId });
  const [market, setMarket] = useState("rome");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [publishOpen, setPublishOpen] = useState(false);
  const [unappliedOnly, setUnappliedOnly] = useState(true);
  // The queue defaults to what is actually waiting on a person. Before this there was no such
  // thing: every correction with no replacement value stayed in the list for ever, so a reviewer
  // could not tell the ones they had dealt with from the ones they had not, and past one page of
  // them the oldest were unreachable.
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const corrections = useQuery({
    queryKey: ["admin", "matching", "corrections", unappliedOnly, unresolvedOnly, page],
    queryFn: () =>
      get<{ items: Correction[]; total: number; limit: number; offset: number }>(
        `/admin/matching/corrections?unapplied_only=${unappliedOnly}&unresolved_only=${unresolvedOnly}&limit=${CORRECTIONS_PER_PAGE}&offset=${page * CORRECTIONS_PER_PAGE}`,
      ),
    enabled: !!me,
  });

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["admin", "matching"] });
      await qc.invalidateQueries({ queryKey: ["admin", "marketplace"] });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };
  const startRun = () => act("run", async () => setSelected((await post<Run>("/admin/matching/runs", { market_id: market, auto_publish: false })).id));
  const review = (pairId: string, decision: "approve" | "reject") => act(pairId, () => post(`/admin/matching/pairs/${pairId}/review`, { decision, note: notes[pairId]?.trim() || null }));
  const publish = () => act("publish", () => post(`/admin/matching/runs/${runId}/publish`)).then(() => setPublishOpen(false));
  /**
   * Resolve one correction.
   *
   * This does not change the member's blueprint — a signal is edited through the blueprint, in the
   * member's own name — it records that a person has read a dispute that cannot resolve itself.
   * Without it the queue had no exit: `applied` is fixed by whether the member supplied a
   * replacement value, so the rows that most needed a human stayed in the list permanently.
   */
  const resolve = (id: string, decision: "actioned" | "no_change") => {
    // Resolving the last row of a page it has just left would strand the reviewer on an empty page
    // with the rest of the queue behind them, so the page steps back with it.
    //
    // Inside the request, not after it: `act` catches the failure and resolves anyway, so a
    // `.then()` here stepped the page back on a review the server had refused — hiding a row that
    // is still unresolved and telling the reviewer, by moving them on, that it had been dealt with.
    const emptiesThePage = unresolvedOnly && page > 0 && (corrections.data?.items.length ?? 0) === 1;
    return act(`correction:${id}`, async () => {
      await post(`/admin/matching/corrections/${id}/review`, { decision, note: reviewNotes[id]?.trim() || null });
      if (emptiesThePage) setPage((n) => Math.max(0, n - 1));
    });
  };

  const run = pairs.data?.run ?? runs.data?.items.find((r) => r.id === runId) ?? null;
  const pending = pairs.data?.items.filter((p) => p.review_status === "pending").length ?? 0;
  const rejected = pairs.data?.items.filter((p) => p.review_status === "rejected").length ?? 0;
  return (
    <AdminShell title="Concierge matching" roles={["concierge", "admin"]}>
      <ErrorState error={error} />
      <Card className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="market" className="mb-1 block text-sm font-semibold">
              Market
            </label>
            <Select id="market" value={market} onChange={(e) => setMarket(e.target.value)}>
              <option value="rome">Rome</option>
              <option value="barcelona">Barcelona</option>
            </Select>
          </div>
          <Button loading={busy === "run"} onClick={startRun}>
            Run weekly batch (hold for review)
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-tertiary">Runs never auto-publish from here. Confirm cohort size, rule version and reviewer coverage first; publish after reviewing allocation and explanation quality.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="p-3">
          <h2 className="mb-2 px-2 font-bold">Runs</h2>
          {runs.isLoading && <Skeleton lines={4} label="Loading runs" />}
          {runs.error && <ErrorState error={runs.error as ApiError} retry={() => runs.refetch()} />}
          {runs.data && runs.data.items.length === 0 && <p className="px-2 text-sm text-ink-secondary">No runs yet.</p>}
          <ul className="space-y-1">
            {runs.data?.items.map((r) => (
              <li key={r.id}>
                <button type="button" aria-current={r.id === runId ? "true" : undefined} onClick={() => setSelected(r.id)} className={cx("w-full rounded-[var(--radius-md)] px-2 py-2 text-left text-sm", r.id === runId ? "bg-ink text-white" : "hover:bg-surface-muted")}>
                  <span className="block font-semibold">
                    {r.market_id} · {r.cohort_date}
                  </span>
                  <span className="block text-xs opacity-80">
                    {r.status} · {r.allocation_count}/{r.candidate_count} · {formatDateTime(r.started_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div>
          {run && (
            <Card className="mb-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-bold">
                    Run {run.id.slice(0, 8)} · {run.status}
                  </h2>
                  <p className="text-sm text-ink-secondary">
                    {run.rules_version} · {run.model_version} · {run.allocation_count} allocated of {run.candidate_count} candidates
                  </p>
                  <p className="text-xs text-ink-tertiary">
                    {Object.entries(run.stats)
                      .filter(([, v]) => typeof v !== "object")
                      .map(([k, v]) => `${k} ${String(v)}`)
                      .join(" · ")}
                  </p>
                </div>
                {run.status !== "published" && (
                  <Button variant="secondary" onClick={() => setPublishOpen(true)} disabled={!pairs.data}>
                    Publish this run
                  </Button>
                )}
              </div>
            </Card>
          )}
          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">
                Member corrections
                {corrections.data ? <span className="ml-2 text-sm font-normal text-ink-secondary">{corrections.data.total} in this view</span> : null}
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-ink-secondary">
                  <input type="checkbox" checked={unappliedOnly} onChange={(e) => { setUnappliedOnly(e.target.checked); setPage(0); }} />
                  Only the ones that changed nothing
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-secondary">
                  <input type="checkbox" checked={unresolvedOnly} onChange={(e) => { setUnresolvedOnly(e.target.checked); setPage(0); }} />
                  Hide the ones already reviewed
                </label>
              </div>
            </div>
            <p className="mb-2 text-sm text-ink-secondary">
              Filed from an introduction&apos;s explanation. Where no replacement value was given, the member&apos;s
              Blueprint is unchanged and this row is the only record — the signal they say is wrong is still live.
            </p>
            {corrections.isLoading && <Skeleton lines={3} label="Loading corrections" />}
            {corrections.error && <ErrorState error={corrections.error as ApiError} retry={() => corrections.refetch()} />}
            {corrections.data && corrections.data.items.length === 0 && (
              <p className="text-sm text-ink-tertiary">Nothing waiting.</p>
            )}
            <ul className="divide-y divide-border">
              {corrections.data?.items.map((c) => (
                <li key={c.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{c.signal_label}</span>
                    <span className="text-sm text-ink-secondary">{c.member.name}</span>
                    <span className={cx("rounded-full border px-2 py-0.5 text-xs", c.applied ? "border-border text-ink-tertiary" : "border-caution text-caution")}>
                      {c.applied ? `changed to ${c.corrected_value}` : "nothing changed"}
                    </span>
                  </div>
                  {c.note && <p className="text-sm italic text-ink-secondary">“{c.note}”</p>}
                  <p className="text-xs text-ink-tertiary">
                    Introduction {c.introduction_id.slice(0, 8)} · {formatDateTime(c.created_at)}
                  </p>
                  {c.review ? (
                    <p className="mt-1 text-xs text-ink-secondary">
                      {/* Named, not just dated: this queue is worked by several people, and
                          "no change needed" is only useful if the next one can see who decided
                          that and ask them why. */}
                      Reviewed by {c.review.reviewer.name} · {formatDateTime(c.review.at)} · {c.review.decision === "actioned" ? "acted on" : "the inference stands"}
                      {c.review.note ? ` · “${c.review.note}”` : ""}
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <TextInput
                        aria-label={`What you did about ${c.signal_label}`}
                        placeholder="What you did, for the next reviewer"
                        value={reviewNotes[c.id] ?? ""}
                        onChange={(e) => setReviewNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      {/* Two ways out, because both are real outcomes: the reviewer changed
                          something, or read it and decided the inference stands. Either resolves
                          the row; neither edits the member's blueprint from here. */}
                      <Button variant="secondary" loading={busy === `correction:${c.id}`} onClick={() => resolve(c.id, "actioned")}>
                        I acted on this
                      </Button>
                      <Button variant="ghost" loading={busy === `correction:${c.id}`} onClick={() => resolve(c.id, "no_change")}>
                        No change needed
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {!!corrections.data && corrections.data.total > CORRECTIONS_PER_PAGE && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Button variant="ghost" disabled={page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>
                  Newer
                </Button>
                <span className="text-ink-secondary">
                  {corrections.data.offset + 1}–{corrections.data.offset + corrections.data.items.length} of {corrections.data.total}
                </span>
                <Button variant="ghost" disabled={corrections.data.offset + corrections.data.items.length >= corrections.data.total} onClick={() => setPage((n) => n + 1)}>
                  Older
                </Button>
              </div>
            )}
          </Card>
          {pairs.isLoading && <Skeleton lines={6} label="Loading pairs" />}
          {pairs.error && <ErrorState error={pairs.error as ApiError} retry={() => pairs.refetch()} />}
          {pairs.data && pairs.data.items.length === 0 && <EmptyState title="No allocated pairs in this run" body="Check gate failures in the run stats and unserved members with capacity." />}
          <ul className="space-y-3">
            {pairs.data?.items.map((p) => (
              <Card key={p.pair_id} as="li">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold">
                    {p.member_a.name} ↔ {p.member_b.name}
                  </h3>
                  <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", p.review_status === "approved" ? "bg-success-soft text-success" : p.review_status === "rejected" ? "bg-caution-soft text-caution" : "bg-context-soft text-context")}>{p.review_status}</span>
                </div>
                <p className="mb-2 text-xs text-ink-secondary">
                  Internal scores (never shown to members): {Object.entries(p.scores).map(([k, v]) => `${k} ${v === null ? "—" : Number(v).toFixed(2)}`).join(" · ")}
                  {Object.keys(p.penalties).length ? ` · penalties: ${Object.entries(p.penalties).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}
                  {` · rank a ${p.rank_for_a ?? "—"} / b ${p.rank_for_b ?? "—"}`}
                </p>
                <p className="mb-2 text-xs text-ink-secondary">
                  Evidence: overlaps {p.evidence.overlaps ?? "—"} · distance {p.evidence.distance_km ?? "—"} km · shared languages {p.evidence.shared_languages?.join(", ") || "—"}
                </p>
                {p.explanations.map((ex) => (
                  <details key={ex.for} className="mb-2 rounded-[var(--radius-md)] border border-border p-2">
                    <summary className="cursor-pointer text-sm font-semibold">Explanation for {ex.for}</summary>
                    <ul className="mt-2 space-y-1 text-sm">
                      {ex.reasons.map((r, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <EvidenceLabel strength={r.strength} /> <span className="font-semibold">{r.label}:</span> {r.text}
                        </li>
                      ))}
                      {ex.friction && <li className="text-ink-secondary">Friction: {ex.friction.text}</li>}
                      {ex.unknown && <li className="text-ink-secondary">Unknown: {ex.unknown.text}</li>}
                    </ul>
                  </details>
                ))}
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <TextInput aria-label={`Review note for ${p.member_a.name} and ${p.member_b.name}`} placeholder="Note (optional, audited)" maxLength={300} value={notes[p.pair_id] ?? p.review_note ?? ""} onChange={(e) => setNotes({ ...notes, [p.pair_id]: e.target.value })} className="sm:flex-1" />
                  <Button size="sm" loading={busy === p.pair_id} onClick={() => review(p.pair_id, "approve")} disabled={run?.status === "published"}>
                    Approve pair
                  </Button>
                  <Button size="sm" variant="danger" loading={busy === p.pair_id} onClick={() => review(p.pair_id, "reject")} disabled={run?.status === "published"}>
                    Reject pair
                  </Button>
                </div>
              </Card>
            ))}
          </ul>
        </div>
      </div>
      <Modal open={publishOpen} title="Publish this run?" onClose={() => setPublishOpen(false)}>
        <p className="mb-2 text-sm text-ink-secondary">Approved and pending pairs become live introductions for members. Rejected pairs are dropped. This is audited under your staff identity and cannot be undone.</p>
        {pending > 0 && <StatusBanner type="caution" title={`${pending} pair${pending === 1 ? "" : "s"} still pending review`} body="They will publish as-is unless you reject them first." />}
        <p className="mb-3 text-sm text-ink">{rejected} rejected · {(pairs.data?.items.length ?? 0) - rejected} to publish.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button loading={busy === "publish"} onClick={publish}>
            Publish introductions
          </Button>
          <Button variant="secondary" onClick={() => setPublishOpen(false)}>
            Keep reviewing
          </Button>
        </div>
      </Modal>
    </AdminShell>
  );
}
