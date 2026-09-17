"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, EmptyState, ErrorState, Skeleton, TextInput } from "@/components/ui";
import { AdminShell, Table, Td } from "@/components/admin/AdminShell";
import { formatDateTime } from "@/lib/format";

type Member = { id: string; name: string; email: string | null; status: string; onboarding_step: string; market: string; roles: string[]; created_at: string };

/** Support: account status and onboarding diagnostics. No private feedback, message content or report narratives. */
export default function AdminMembersPage() {
  const { me } = useAuth();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const q = useQuery({ queryKey: ["admin", "members", query], queryFn: () => get<{ items: Member[] }>(`/admin/members${query ? `?q=${encodeURIComponent(query)}` : ""}`), enabled: !!me });
  return (
    <AdminShell title="Members (support)" roles={["support", "concierge", "safety_reviewer", "admin"]}>
      <form
        className="mb-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <TextInput aria-label="Search by email" placeholder="Search by email" value={draft} onChange={(e) => setDraft(e.target.value)} className="sm:max-w-sm" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <p className="mb-4 text-sm text-ink-secondary">Emails are shown to support and admin roles only. Private feedback, message text and report narratives never appear here.</p>
      {q.isLoading && <Skeleton lines={5} label="Loading members" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No members match" />}
      {q.data && q.data.items.length > 0 && (
        <Table headers={["Name", "Email", "Status", "Onboarding step", "Market", "Roles", "Joined"]} caption="Members">
          {q.data.items.map((m) => (
            <tr key={m.id}>
              <Td>{m.name}</Td>
              <Td>{m.email ?? "hidden for your role"}</Td>
              <Td>{m.status.replace(/_/g, " ")}</Td>
              <Td>{m.onboarding_step.replace(/_/g, " ")}</Td>
              <Td>{m.market}</Td>
              <Td>{m.roles.join(", ")}</Td>
              <Td>{formatDateTime(m.created_at)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </AdminShell>
  );
}
