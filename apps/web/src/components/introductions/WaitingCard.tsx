"use client";

import Link from "next/link";
import { Card, KeyValue, LinkButton } from "@/components/ui";
import type { WaitingPayload } from "./types";

const REASON_TITLE: Record<string, string> = {
  trial_used: "Trial introduction used",
  capacity: "You're at the pilot limit",
  no_qualified_inventory: "Nobody qualifies right now",
  thin_inventory: "The qualified pool is small",
  next_batch: "You're in the next batch",
};

/** I06 body: transparent reasons, protected credit, optional preference review. Never pressure. */
export function WaitingCard({ waiting, standalone }: { waiting: WaitingPayload; standalone?: boolean }) {
  return (
    <div className="space-y-4">
      <Card as="section" aria-labelledby="waiting-title">
        <h2 id="waiting-title" className="text-lg font-bold text-ink">
          {standalone ? "The current picture" : "No introduction is open right now"}
        </h2>
        <ul className="mt-3 space-y-3">
          {waiting.reasons.map((r) => (
            <li key={r.code} className="rounded-[var(--radius-lg)] bg-surface-muted p-4">
              <p className="font-semibold text-ink">{REASON_TITLE[r.code] ?? "What's going on"}</p>
              <p className="mt-0.5 text-sm text-ink-secondary">{r.text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <KeyValue
            items={[
              { k: "Verified members in your area", v: waiting.verified_pool },
              { k: "Pass both sides' Must criteria", v: waiting.eligible_after_must },
              { k: "Open slots for you", v: waiting.capacity },
              { k: "Next batch", v: waiting.next_batch === "weekly" ? "Weekly, after concierge review" : waiting.next_batch },
            ]}
          />
        </div>
      </Card>
      <Card as="section" aria-labelledby="credit-title" className="border-success bg-success-soft/40">
        <h2 id="credit-title" className="font-semibold text-ink">
          Your credit is protected
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">{waiting.protected_credits > 0 ? `${waiting.protected_credits} protected credit${waiting.protected_credits === 1 ? "" : "s"} carry forward. You are never charged for weeks without a qualified introduction.` : "You are never charged for weeks without a qualified introduction."}</p>
      </Card>
      <Card as="section" aria-labelledby="broaden-title">
        <h2 id="broaden-title" className="font-semibold text-ink">
          Optional: review flexible preferences
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">{waiting.broaden_hint}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href="/you/preferences" variant="secondary">
            Preview what broader Prefer settings would change
          </LinkButton>
          <Link href="/today" className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-action">
            I'm happy to wait
          </Link>
        </div>
      </Card>
    </div>
  );
}
