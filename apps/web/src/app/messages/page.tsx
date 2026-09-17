"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { relative } from "@/lib/format";
import type { ConversationSummary } from "@/lib/types";
import { AppShell } from "@/components/shell/AppShell";
import { Avatar, Card, EmptyState, ErrorState, LinkButton, PageTitle, Skeleton, VerificationBadge, cx } from "@/components/ui";
import { dateContext } from "@/components/messages/ConversationHeader";
import { CONVERSATION_STATUS_LABEL, type ConversationList } from "@/components/messages/types";

/** M01 Conversation inbox: small, intentional, with verification and date-status context. */
export default function InboxPage() {
  const { me } = useRequireMember();
  const q = useQuery({ queryKey: ["conversations"], queryFn: () => get<ConversationList>("/conversations"), enabled: !!me, refetchInterval: 30_000 });
  const items = q.data?.items ?? [];
  const active = items.filter((c) => c.status === "active");
  const ended = items.filter((c) => c.status !== "active");

  return (
    <AppShell>
      <PageTitle eyebrow="Messages" title="Can we build enough trust to meet?" lede="Only reciprocal conversations live here. Aim for one real, public date rather than many open threads." />
      {q.isLoading && <Skeleton lines={4} label="Loading conversations" />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && items.length === 0 && <EmptyState title="No conversations yet" body="A conversation opens only after you and an introduction both privately say yes." action={<LinkButton href="/introductions" variant="secondary">See your introductions</LinkButton>} />}
      {q.data && items.length > 0 && (
        <div className="space-y-6">
          <p className="text-sm text-ink-secondary">
            {active.length} of {q.data.pilot_cap} pilot conversations open. The cap protects attention and keeps introductions from becoming a collection.
          </p>
          {active.length > 0 && (
            <ul className="space-y-2" aria-label="Active conversations">
              {active.map((c) => (
                <ConversationRow key={c.id} c={c} />
              ))}
            </ul>
          )}
          {ended.length > 0 && (
            <section aria-labelledby="ended">
              <h2 id="ended" className="mb-2 text-base font-semibold text-ink">
                Ended
              </h2>
              <ul className="space-y-2">
                {ended.map((c) => (
                  <ConversationRow key={c.id} c={c} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}

function ConversationRow({ c }: { c: ConversationSummary }) {
  const photo = c.other.media.find((m) => m.url)?.url ?? null;
  const ended = c.status !== "active";
  const context = ended ? (CONVERSATION_STATUS_LABEL[c.status] ?? c.status) : (dateContext(c) ?? null);
  return (
    <Card as="li" className={cx("p-3", c.unread > 0 && "border-action")}>
      <Link href={`/messages/${c.id}`} className="flex min-h-12 items-center gap-3">
        <Avatar name={c.other.display_name} url={photo} size={48} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cx("font-semibold", ended ? "text-ink-secondary" : "text-ink")}>{c.other.display_name}</span>
            {!ended && <VerificationBadge verified={c.other.verified} small />}
            {c.safety_hold && <span className="rounded-full bg-context-soft px-2 py-0.5 text-xs font-semibold text-context">Safety review</span>}
          </span>
          {context && <span className="block text-xs font-semibold text-context">{context}</span>}
          <span className="block truncate text-sm text-ink-secondary">{c.last_message ? `${c.last_message.mine ? "You: " : ""}${c.last_message.text || "…"}` : "Say hello when you're ready. No rush."}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-ink-tertiary">
          {c.last_message ? relative(c.last_message.sent_at) : relative(c.opened_at)}
          {c.unread > 0 && (
            <span className="rounded-full bg-action px-2 py-0.5 font-semibold text-white">
              {c.unread} <span className="sr-only">unread</span>
            </span>
          )}
        </span>
      </Link>
    </Card>
  );
}
