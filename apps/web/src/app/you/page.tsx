"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth, useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, PageTitle, Skeleton, VerificationBadge } from "@/components/ui";
import { INTENT_LABEL } from "@/lib/format";

const LINKS: { href: string; label: string; body: string }[] = [
  { href: "/you/profile", label: "Profile", body: "Exactly what introductions see, and what stays private." },
  { href: "/you/blueprint", label: "Dating Blueprint", body: "Every inference, its evidence and how to correct it." },
  { href: "/you/preferences", label: "Preferences & dealbreakers", body: "Must, Prefer and Open, with the trade-off shown first." },
  { href: "/you/travel", label: "Travel mode", body: "Time-bounded matching in another city (after the pilot)." },
  { href: "/you/verification", label: "Verification", body: "Status, expiry and what each badge does and doesn't mean." },
  { href: "/you/membership", label: "Membership & credits", body: "One transparent price, protected credits, cancel in-app." },
  { href: "/you/settings", label: "Language, alerts & accessibility", body: "Locale, time zone, quiet hours, text size, motion, contrast." },
  { href: "/you/privacy", label: "Privacy & account", body: "Visibility map, consents, export, pause, delete." },
  { href: "/you/passport", label: "Dating Passport", body: "A revocable share link for a friend's second opinion (later)." },
];

/** You hub: what the system knows and what you control. */
export default function YouPage() {
  const { me } = useRequireMember();
  const { signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <AppShell>
      <PageTitle eyebrow="You" title="What we know, and what you control" />
      {!me ? (
        <Skeleton lines={4} />
      ) : (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-ink">{me.email}</p>
              <p className="text-sm text-ink-secondary">
                {me.intent ? INTENT_LABEL[me.intent] ?? me.intent : "Intent not set"} · {me.capabilities.entitlements.plan_name}
              </p>
            </div>
            <VerificationBadge verified={me.verification_status === "verified"} />
          </div>
          {me.paused && <p className="mt-2 text-sm text-context">Your account is paused: no new introductions until you resume in Privacy & account.</p>}
        </Card>
      )}
      <ul className="space-y-2">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block rounded-[var(--radius-lg)] border border-border bg-surface p-4 hover:bg-surface-muted">
              <span className="flex items-center justify-between">
                <span className="font-semibold text-ink">{l.label}</span>
                <span aria-hidden className="text-ink-tertiary">
                  →
                </span>
              </span>
              <span className="block text-sm text-ink-secondary">{l.body}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-8 border-t border-border pt-4">
        <Button
          variant="secondary"
          fullWidth
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await signOut();
            router.replace("/welcome");
          }}
        >
          Sign out of this device
        </Button>
        <p className="mt-2 text-center text-xs text-ink-tertiary">Signing out keeps your account, introductions and conversations. Unsent drafts on this device are discarded.</p>
      </div>
    </AppShell>
  );
}
