"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EmptyState, ErrorState, Select, Skeleton } from "@/components/ui";
import { AdminShell, Table, Td } from "@/components/admin/AdminShell";
import { CATEGORY_LABEL, CASE_STATUS_LABEL, SeverityTag } from "@/components/safety/shared";
import { formatDateTime } from "@/lib/format";

type Item = { id: string; receipt_code: string; severity: string; category: string; status: string; urgency: string; specialist_workflow: string | null; submitted_at: string; assigned: boolean };
const STATUSES = ["", "triaged", "assigned", "in_review", "awaiting_information", "actioned", "appealed", "closed"];

/** Safety cases queue ordered by severity. Opening a case requires a declared purpose (on the detail page). */
export default function AdminSafetyPage() {
  const { me } = useAuth();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["admin", "safety", "cases", status], queryFn: () => get<{ items: Item[] }>(`/admin/safety/cases${status ? `?status=${status}` : ""}`), enabled: !!me, refetchInterval: 30_000 });
  return (
    <AdminShell title="Safety cases" roles={["safety_reviewer", "admin"]}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="sm:w-64">
          <label htmlFor="st" className="mb-1 block text-sm font-semibold">
            Status
          </label>
          <Select id="st" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? CASE_STATUS_LABEL[s] ?? s : "All open"}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-sm text-ink-secondary">P0 and P1 first. Specialist workflows (child safety, NCII, imminent harm, sexual violence) follow their own procedures; this queue only shows routing.</p>
      </div>
      {q.isLoading && <Skeleton lines={5} label="Loading cases" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No cases in this view" />}
      {q.data && q.data.items.length > 0 && (
        <Table headers={["Severity", "Receipt", "Category", "Urgency", "Status", "Specialist", "Submitted", ""]} caption="Safety case queue">
          {q.data.items.map((c) => (
            <tr key={c.id} className={c.assigned ? "bg-action-soft/40" : undefined}>
              <Td>
                <SeverityTag severity={c.severity} />
              </Td>
              <Td>{c.receipt_code}</Td>
              <Td>{CATEGORY_LABEL[c.category]?.label ?? c.category}</Td>
              <Td>{c.urgency.replace(/_/g, " ")}</Td>
              <Td>
                {CASE_STATUS_LABEL[c.status] ?? c.status}
                {c.assigned ? " · yours" : ""}
              </Td>
              <Td>{c.specialist_workflow ?? "—"}</Td>
              <Td>{formatDateTime(c.submitted_at)}</Td>
              <Td>
                <Link href={`/admin/safety/${c.id}`} className="font-semibold text-action underline">
                  Open
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </AdminShell>
  );
}
