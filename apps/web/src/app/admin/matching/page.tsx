"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorState, EvidenceLabel, Modal, Select, Skeleton, StatusBanner, TextInput, cx } from "@/components/ui";
import { AdminShell, Table, Td } from "@/components/admin/AdminShell";
import { formatDateTime } from "@/lib/format";
import type { Strength } from "@/lib/types";

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
      <Table headers={[]} caption="">
        <></>
      </Table>
    </AdminShell>
  );
}
