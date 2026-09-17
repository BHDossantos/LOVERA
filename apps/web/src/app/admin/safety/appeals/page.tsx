"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, EmptyState, ErrorState, Field, KeyValue, Select, Skeleton, StatusBanner, TextInput } from "@/components/ui";
import { AdminShell, Table, Td } from "@/components/admin/AdminShell";
import { formatDateTime } from "@/lib/format";

type Item = { id: string; status: string; member_name: string; action_type: string | null; original_reviewer_id: string | null; can_review: boolean; created_at: string };
type Detail = { id: string; status: string; statement: string; member_name: string; action: { id: string; type: string; reason_code: string; public_notice: string | null; reviewer_id: string | null; report_id: string | null } | null; independent_review_ok: boolean; created_at: string };
const RATIONALE = ["evidence_insufficient", "evidence_sufficient", "context_changed", "proportionality", "policy_misapplied", "other"];

/** Appeals: list, detail with declared purpose, decide. The independent-reviewer rule is surfaced and enforced by the API. */
export default function AdminAppealsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin", "appeals"], queryFn: () => get<{ items: Item[] }>("/admin/safety/appeals"), enabled: !!me });
  const [selected, setSelected] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("appeal_review");
  const detail = useQuery({ queryKey: ["admin", "appeal", selected, purpose], queryFn: () => get<Detail>(`/admin/safety/appeals/${selected}?purpose=${encodeURIComponent(purpose)}`), enabled: !!selected && purpose.length >= 3 });
  const [outcome, setOutcome] = useState<"upheld" | "overturned" | "modified">("upheld");
  const [rationale, setRationale] = useState(RATIONALE[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const decide = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/admin/safety/appeals/${selected}/decide`, { outcome, rationale_code: rationale });
      await qc.invalidateQueries({ queryKey: ["admin"] });
      setSelected(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const d = detail.data;
  return (
    <AdminShell title="Appeals" roles={["safety_reviewer", "admin"]}>
      <StatusBanner type="info" title="Independent reviewer rule" body="An appeal must be decided by a reviewer who did not make the original decision. Rows you cannot review are marked; the API refuses the decision regardless." />
      <ErrorState error={error} />
      {list.isLoading && <Skeleton lines={4} label="Loading appeals" />}
      {list.error && <ErrorState error={list.error as ApiError} retry={() => list.refetch()} />}
      {list.data && list.data.items.length === 0 && <EmptyState title="No open appeals" />}
      {list.data && list.data.items.length > 0 && (
        <Table headers={["Member", "Action", "Status", "Filed", "Independent?", ""]} caption="Open appeals">
          {list.data.items.map((a) => (
            <tr key={a.id}>
              <Td>{a.member_name}</Td>
              <Td>{a.action_type?.replace(/_/g, " ") ?? "—"}</Td>
              <Td>{a.status}</Td>
              <Td>{formatDateTime(a.created_at)}</Td>
              <Td>{a.can_review ? "✓ You may decide" : "✕ You made the original decision"}</Td>
              <Td>
                <Button size="sm" variant="secondary" onClick={() => setSelected(a.id)}>
                  Open
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {selected && (
        <Card className="mt-4">
          <Field label="Access purpose (audited)" htmlFor="pp">
            <TextInput id="pp" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>
          {detail.isLoading && <Skeleton lines={4} label="Loading the appeal" />}
          {detail.error && <ErrorState error={detail.error as ApiError} retry={() => detail.refetch()} />}
          {d && (
            <>
              <h2 className="mb-2 font-bold">Appeal from {d.member_name}</h2>
              <KeyValue
                items={[
                  { k: "Filed", v: formatDateTime(d.created_at) },
                  { k: "Original action", v: d.action ? `${d.action.type.replace(/_/g, " ")} · ${d.action.reason_code}` : "—" },
                  { k: "Notice given", v: d.action?.public_notice ?? "—" },
                  { k: "Independent review", v: d.independent_review_ok ? "✓ You did not make the original decision" : "✕ You made the original decision; hand this to a colleague" },
                ]}
              />
              <h3 className="mt-3 text-sm font-semibold">Member statement</h3>
              <p className="mb-3 whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface-muted p-3 text-ink">{d.statement}</p>
              <p className="mb-3 text-xs text-ink-tertiary">Appeal statements are never used for matching. Reporter identity stays sealed.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Outcome" htmlFor="oc">
                  <Select id="oc" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                    <option value="upheld">Upheld: decision stands</option>
                    <option value="overturned">Overturned: restriction lifted</option>
                    <option value="modified">Modified: restriction lifted, replaced by a lesser action</option>
                  </Select>
                </Field>
                <Field label="Rationale code" htmlFor="rt">
                  <Select id="rt" value={rationale} onChange={(e) => setRationale(e.target.value)}>
                    {RATIONALE.map((r) => (
                      <option key={r} value={r}>
                        {r.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button loading={busy} disabled={!d.independent_review_ok} onClick={decide}>
                  Record decision: {outcome}
                </Button>
                <Button variant="secondary" onClick={() => setSelected(null)}>
                  Close without deciding
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </AdminShell>
  );
}
