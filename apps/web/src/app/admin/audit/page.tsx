"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EmptyState, ErrorState, Select, Skeleton } from "@/components/ui";
import { AdminShell, Table, Td } from "@/components/admin/AdminShell";
import { formatDateTime } from "@/lib/format";

type Event = { id: string; actor_type: string; actor_id: string | null; action: string; resource_type: string; resource_id: string | null; purpose: string | null; metadata: Record<string, unknown>; occurred_at: string; hash: string };
const TYPES = ["", "member", "match_run", "candidate_pair", "introduction", "date_plan", "date_check_in", "safety_report", "appeal", "verification", "subscription", "checkout", "privacy_request", "preference", "blueprint_version", "post_date_feedback", "conversation"];

/** Audit log: every sensitive action with actor, purpose, redacted metadata and chain hash. Admin only. */
export default function AdminAuditPage() {
  const { me } = useAuth();
  const [type, setType] = useState("");
  const q = useQuery({ queryKey: ["admin", "audit", type], queryFn: () => get<{ items: Event[] }>(`/admin/audit${type ? `?resource_type=${type}` : ""}`), enabled: !!me });
  return (
    <AdminShell title="Audit log" roles={["admin"]}>
      <div className="mb-4 sm:w-72">
        <label htmlFor="rt" className="mb-1 block text-sm font-semibold">
          Resource type
        </label>
        <Select id="rt" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t ? t.replace(/_/g, " ") : "All (latest 100)"}
            </option>
          ))}
        </Select>
      </div>
      {q.isLoading && <Skeleton lines={6} label="Loading audit events" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No events" />}
      {q.data && q.data.items.length > 0 && (
        <Table headers={["When", "Actor", "Action", "Resource", "Purpose", "Metadata (redacted)", "Hash"]} caption="Audit events">
          {q.data.items.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap">{formatDateTime(e.occurred_at)}</Td>
              <Td>
                {e.actor_type}
                {e.actor_id ? ` · ${e.actor_id.slice(0, 8)}` : ""}
              </Td>
              <Td className="font-semibold">{e.action}</Td>
              <Td>
                {e.resource_type}
                {e.resource_id ? ` · ${e.resource_id.slice(0, 8)}` : ""}
              </Td>
              <Td>{e.purpose ?? "—"}</Td>
              <Td className="max-w-xs break-all font-mono text-xs">{Object.keys(e.metadata ?? {}).length ? JSON.stringify(e.metadata) : "—"}</Td>
              <Td className="font-mono text-xs">
                <span title={e.hash}>{e.hash.slice(0, 10)}…</span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </AdminShell>
  );
}
