"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, EmptyState, ErrorState, Modal, Select, Skeleton } from "@/components/ui";
import { AdminShell, Table, Td } from "@/components/admin/AdminShell";
import { formatDateTime } from "@/lib/format";

type Item = { id: string; member_name: string; status: string; failure_reason_code: string | null; review_note: string | null; created_at: string };
const REJECT_CODES = ["document_mismatch", "liveness_failed", "under_18", "duplicate_identity", "unreadable_document", "rejected_after_review"];

/** Verification review: vendor result, mismatch reason, member note; approve / recheck / reject. No matching data. */
export default function AdminVerificationPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "verification"], queryFn: () => get<{ items: Item[] }>("/admin/verification/queue"), enabled: !!me });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [code, setCode] = useState(REJECT_CODES[0]);

  const decide = async (id: string, decision: "approve" | "recheck" | "reject") => {
    setBusy(`${id}:${decision}`);
    setError(null);
    try {
      await post(`/admin/verification/${id}/review`, { decision, reason_code: decision === "reject" ? code : null });
      await qc.invalidateQueries({ queryKey: ["admin", "verification"] });
      await qc.invalidateQueries({ queryKey: ["admin", "marketplace"] });
      setRejecting(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminShell title="Verification review" roles={["safety_reviewer", "admin"]}>
      <p className="mb-4 text-sm text-ink-secondary">Vendor outcome and the member's own note only. Matching scores and messages are never part of this review. Every decision is audited.</p>
      <ErrorState error={error} />
      {q.isLoading && <Skeleton lines={4} label="Loading the queue" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="Queue is empty" body="No failed or escalated verifications right now." />}
      {q.data && q.data.items.length > 0 && (
        <Table headers={["Member", "Status", "Vendor reason", "Member note", "Since", "Decision"]} caption="Verification review queue">
          {q.data.items.map((v) => (
            <tr key={v.id}>
              <Td>{v.member_name}</Td>
              <Td>{v.status.replace(/_/g, " ")}</Td>
              <Td>{v.failure_reason_code ?? "—"}</Td>
              <Td className="max-w-xs whitespace-pre-wrap">{v.review_note ?? "—"}</Td>
              <Td>{formatDateTime(v.created_at)}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" loading={busy === `${v.id}:approve`} onClick={() => decide(v.id, "approve")}>
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" loading={busy === `${v.id}:recheck`} onClick={() => decide(v.id, "recheck")}>
                    Ask to recheck
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setRejecting(v)}>
                    Reject
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!rejecting} title={`Reject ${rejecting?.member_name ?? ""}'s verification?`} onClose={() => setRejecting(null)}>
        <p className="mb-3 text-sm text-ink-secondary">The member sees the reason code and can request another human review. They cannot receive introductions until verified.</p>
        <label htmlFor="rc" className="mb-1 block text-sm font-semibold">
          Reason code
        </label>
        <Select id="rc" value={code} onChange={(e) => setCode(e.target.value)}>
          {REJECT_CODES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button variant="danger" loading={!!rejecting && busy === `${rejecting.id}:reject`} onClick={() => rejecting && decide(rejecting.id, "reject")}>
            Reject with this reason
          </Button>
          <Button variant="secondary" onClick={() => setRejecting(null)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </AdminShell>
  );
}
