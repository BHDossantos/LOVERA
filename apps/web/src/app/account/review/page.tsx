"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, KeyValue, LinkButton, PageTitle, Skeleton, StatusBanner, TextArea } from "@/components/ui";
import { formatDate } from "@/lib/format";

type Action = { id: string; type: string; reason_category: string; notice: string; starts_at: string | null; ends_at: string | null; active: boolean; decision_source: string; appealable: boolean; appeal: { id: string; status: string; outcome: string | null; decided_at: string | null } | null; evidence_types: string[] };
type Review = { status: string; actions: Action[]; rights: string[] };

const TYPE_LABEL: Record<string, string> = { warning: "Warning", capability_limit: "Some features limited", restrict: "Account restricted", suspend: "Account suspended", ban: "Account closed" };

/** S04 Decision & appeal: reason category, effect, duration, evidence types, human appeal. Reachable even when restricted. */
export default function AccountReviewPage() {
  const { me } = useRequireMember({ allowRestricted: true });
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["account-review"], queryFn: () => get<Review>("/account/review"), enabled: !!me });
  const [appealing, setAppealing] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const appeal = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ appeal_id: string; status: string; acknowledgment_target: string }>(`/account/review/${id}/appeal`, { statement: statement.trim() });
      setDone(r.acknowledgment_target);
      setAppealing(null);
      setStatement("");
      await qc.invalidateQueries({ queryKey: ["account-review"] });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const r = q.data;
  return (
    <AppShell>
      <PageTitle eyebrow="Account review" title="Decisions about your account" lede="Every meaningful adverse decision is explained and can be appealed to a person who did not make it. Reporter identities are never disclosed." />
      {me?.status === "restricted" && <StatusBanner type="caution" title="Your account is currently restricted" body="You can still message existing connections, use every safety tool, export your data and appeal below." />}
      {done && <StatusBanner type="success" title="Appeal received" body={`Acknowledgment ${done}. A reviewer who did not make the original decision will look at it.`} />}
      {q.isLoading && <Skeleton lines={5} label="Loading decisions" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      <ErrorState error={error} />
      {r && r.actions.length === 0 && <EmptyState title="No decisions on record" body="Nothing has been applied to your account. If that changes you'll be notified and can appeal here." />}
      {r?.actions.map((a) => (
        <Card key={a.id} className="mb-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">{TYPE_LABEL[a.type] ?? a.type.replace(/_/g, " ")}</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.active ? "bg-context-soft text-context" : "bg-surface-muted text-ink-secondary"}`}>{a.active ? "● Active" : "○ Ended"}</span>
          </div>
          <p className="mb-3 text-ink">{a.notice}</p>
          <KeyValue
            items={[
              { k: "Reason category", v: a.reason_category.replace(/_/g, " ") },
              { k: "Applied", v: formatDate(a.starts_at) || "—" },
              { k: "Duration", v: a.ends_at ? `Until ${formatDate(a.ends_at)}` : "Until reviewed" },
              { k: "Decided by", v: a.decision_source === "human" ? "A human reviewer" : "An automatic protective rule, pending human review" },
              { k: "Evidence types considered", v: a.evidence_types.join(", ") },
            ]}
          />
          {a.appeal && (
            <p className="mt-3 text-sm text-ink">
              Appeal {a.appeal.status}
              {a.appeal.outcome ? ` · ${a.appeal.outcome}` : ""}
              {a.appeal.decided_at ? ` on ${formatDate(a.appeal.decided_at)}` : ""}
            </p>
          )}
          {a.appealable && appealing !== a.id && (
            <Button className="mt-3" variant="secondary" onClick={() => setAppealing(a.id)}>
              Start an appeal
            </Button>
          )}
          {appealing === a.id && (
            <div className="mt-3">
              <label htmlFor={`st-${a.id}`} className="mb-1 block text-sm font-semibold">
                Your context for a second review
              </label>
              <TextArea id={`st-${a.id}`} rows={5} minLength={10} maxLength={4000} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="What you'd like the reviewer to know. You don't need to guess who reported you, and you shouldn't try to identify them." />
              <p className="mt-1 text-xs text-ink-tertiary">Appeal statements are never used for matching and never shown to the other member.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Button loading={busy} disabled={statement.trim().length < 10} onClick={() => appeal(a.id)}>
                  Send my appeal
                </Button>
                <Button variant="ghost" onClick={() => setAppealing(null)}>
                  Not now
                </Button>
              </div>
            </div>
          )}
        </Card>
      ))}
      {r && (
        <Card className="mb-4">
          <h2 className="mb-2 font-bold">Your rights</h2>
          <ul className="list-disc pl-5 text-ink-secondary">
            {r.rights.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <LinkButton href="/you/privacy" variant="secondary">
              Export or delete my data
            </LinkButton>
            <LinkButton href="/safety" variant="ghost">
              Safety Center
            </LinkButton>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
