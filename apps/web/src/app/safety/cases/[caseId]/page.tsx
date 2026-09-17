"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, KeyValue, LinkButton, PageTitle, Skeleton, TextArea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CASE_STATUS_LABEL, CATEGORY_LABEL, EmergencyCard, PROTECTION_LABEL, SeverityTag, type SafetyCase } from "@/components/safety/shared";

/** S03 Case status: receipt, protection, response target, updates, secure additions. Never exposes the other person's data. */
export default function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["safety-case", caseId], queryFn: () => get<SafetyCase>(`/safety/cases/${caseId}`), enabled: !!me });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const addNote = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await post<SafetyCase>(`/safety/cases/${caseId}/notes`, { note: note.trim() });
      qc.setQueryData(["safety-case", caseId], next);
      qc.invalidateQueries({ queryKey: ["safety-cases"] });
      setNote("");
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const c = q.data;
  return (
    <AppShell>
      {q.isLoading && <Skeleton lines={6} label="Loading the case" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      <ErrorState error={error} />
      {c && (
        <>
          <PageTitle eyebrow={`Case ${c.receipt_code}`} title={CATEGORY_LABEL[c.category]?.label ?? c.category} lede={`${CASE_STATUS_LABEL[c.status] ?? c.status} · submitted ${formatDateTime(c.submitted_at)}`} />
          <div className="mb-4">
            <SeverityTag severity={c.severity} />
          </div>
          <EmergencyCard emergency={c.support.emergency} />
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Protection in place</h2>
            <ul className="list-disc pl-5 text-ink">
              {c.protection_applied.length ? c.protection_applied.map((p) => <li key={p}>{PROTECTION_LABEL[p] ?? p.replace(/_/g, " ")}</li>) : <li>No member was named, so no contact separation was needed. The report is on record.</li>}
            </ul>
            <KeyValue
              items={[
                { k: "Response target", v: c.response_target },
                { k: "Evidence on file", v: `${c.evidence_count}` },
                { k: "Last updated", v: formatDateTime(c.updated_at) },
                ...(c.resolution_code ? [{ k: "Resolution", v: c.resolution_code.replace(/_/g, " ") }] : []),
              ]}
            />
            <p className="mt-2 text-xs text-ink-tertiary">{c.support.note}</p>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Updates</h2>
            {c.updates.length === 0 && <p className="text-sm text-ink-secondary">No updates yet. You'll be notified when a reviewer adds one.</p>}
            <ol className="divide-y divide-border">
              {c.updates.map((u, i) => (
                <li key={i} className="py-2">
                  <p className="text-ink">{u.note}</p>
                  <time dateTime={u.at} className="text-xs text-ink-tertiary">
                    {formatDateTime(u.at)}
                  </time>
                </li>
              ))}
            </ol>
          </Card>
          {c.status !== "closed" && (
            <Card className="mb-4">
              <h2 className="mb-1 font-bold">Add information</h2>
              <p className="mb-2 text-sm text-ink-secondary">Anything you remember later, or a change in the situation. Stored securely with the case.</p>
              <TextArea rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the reviewer" />
              <Button className="mt-2" loading={busy} disabled={!note.trim()} onClick={addNote}>
                Add to my case
              </Button>
            </Card>
          )}
          <LinkButton href="/safety/cases" variant="ghost" fullWidth>
            All cases
          </LinkButton>
        </>
      )}
    </AppShell>
  );
}
