"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { relative } from "@/lib/format";
import type { Notification } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, PageTitle, Skeleton, cx } from "@/components/ui";

type List = { items: Notification[]; unread: number };

const GROUPS: { key: string; label: string }[] = [
  { key: "safety", label: "Safety" },
  { key: "introductions", label: "Introductions" },
  { key: "conversations", label: "Conversations" },
  { key: "dates", label: "Dates" },
  { key: "account", label: "Account" },
];

/** T02 Notifications: grouped, actionable, deep-linked. No manufactured scarcity. */
export default function NotificationsPage() {
  const { me } = useRequireMember();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => get<List>("/notifications"), enabled: !!me });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const markRead = async (ids: string[] | null) => {
    setBusy(true);
    setError(null);
    try {
      await post("/notifications/read", { ids });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const items = q.data?.items ?? [];
  const known = new Set(GROUPS.map((g) => g.key));
  const groups = [...GROUPS, ...Array.from(new Set(items.map((i) => i.group).filter((g) => !known.has(g)))).map((g) => ({ key: g, label: g.charAt(0).toUpperCase() + g.slice(1) }))];

  return (
    <AppShell>
      <PageTitle eyebrow="Notifications" title="What changed" lede="Only updates you can act on. Deadlines reflect real reciprocal windows and can be extended once." />
      <ErrorState error={error} />
      {q.isLoading && <Skeleton lines={5} label="Loading notifications" />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && items.length === 0 && <EmptyState title="Nothing new" body="You're up to date. We never send nudges just to bring you back." />}
      {q.data && items.length > 0 && (
        <div className="space-y-6">
          {(q.data.unread ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink-secondary">{q.data.unread} unread</p>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => markRead(null)}>
                Mark all as read
              </Button>
            </div>
          )}
          {groups.map((g) => {
            const list = items.filter((i) => i.group === g.key);
            if (list.length === 0) return null;
            return (
              <section key={g.key} aria-labelledby={`group-${g.key}`}>
                <h2 id={`group-${g.key}`} className="mb-2 text-base font-semibold text-ink">
                  {g.label}
                </h2>
                <ul className="space-y-2">
                  {list.map((n) => (
                    <NotificationRow key={n.id} n={n} onRead={() => markRead([n.id])} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function NotificationRow({ n, onRead }: { n: Notification; onRead: () => void }) {
  const unread = !n.read_at;
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className={cx("font-semibold", unread ? "text-ink" : "text-ink-secondary")}>
          {unread && <span className="sr-only">Unread: </span>}
          {n.title}
        </span>
        <span className="shrink-0 text-xs text-ink-tertiary">{relative(n.created_at)}</span>
      </span>
      <span className="mt-0.5 block text-sm text-ink-secondary">{n.body}</span>
    </>
  );
  return (
    <Card as="li" className={cx("p-4", unread && "border-action")}>
      {n.deep_link ? (
        <Link href={n.deep_link} onClick={unread ? onRead : undefined} className="block min-h-11">
          {body}
          <span className="mt-1 block text-sm font-semibold text-action">Open →</span>
        </Link>
      ) : (
        <div className="min-h-11">{body}</div>
      )}
      {unread && (
        <button type="button" onClick={onRead} className="mt-1 text-xs font-semibold text-ink-secondary underline">
          Mark as read
        </button>
      )}
    </Card>
  );
}
