"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, del, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, LinkButton, Modal, PageTitle, Skeleton } from "@/components/ui";
import { formatDate } from "@/lib/format";

type Block = { member_id: string; display_name: string; created_at: string };

/** Blocked members: silent, immediate, reversible with a clear consequence note. */
export default function BlocksPage() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["blocks"], queryFn: () => get<{ items: Block[] }>("/blocks"), enabled: !!me });
  const [confirm, setConfirm] = useState<Block | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const unblock = async () => {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      await del(`/blocks/${confirm.member_id}`);
      await qc.invalidateQueries({ queryKey: ["blocks"] });
      await qc.invalidateQueries({ queryKey: ["safety"] });
      setConfirm(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageTitle eyebrow="Safety · Blocks" title="Blocked members" lede="Blocking is silent. The other person is never told who blocked them; they simply can't reach you here." />
      {q.isLoading && <Skeleton lines={3} label="Loading blocked members" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      <ErrorState error={error} />
      {q.data && q.data.items.length === 0 && <EmptyState title="Nobody blocked" body="You can block from any profile, conversation or report, in two taps, without giving a reason." action={<LinkButton href="/safety/report" variant="secondary">Report or block someone</LinkButton>} />}
      {q.data && q.data.items.length > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {q.data.items.map((b) => (
              <li key={b.member_id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold text-ink">{b.display_name}</p>
                  <p className="text-sm text-ink-secondary">Blocked {formatDate(b.created_at)}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setConfirm(b)} aria-label={`Unblock ${b.display_name}`}>
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal open={!!confirm} title={`Unblock ${confirm?.display_name ?? ""}?`} onClose={() => setConfirm(null)}>
        <ul className="mb-3 list-disc pl-5 text-sm text-ink-secondary">
          <li>Closed conversations, introductions and dates are not restored.</li>
          <li>They are not notified. Nothing tells them a block existed.</li>
          <li>Any report you made stays open and unaffected.</li>
          <li>You can block again at any time.</li>
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button loading={busy} onClick={unblock}>
            Remove the block
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Keep the block
          </Button>
        </div>
      </Modal>
    </AppShell>
  );
}
