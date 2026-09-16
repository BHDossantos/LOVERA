"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cx } from "@/components/ui";

const TABS = [
  { href: "/today", label: "Today", glyph: "◎" },
  { href: "/introductions", label: "Introductions", glyph: "✦" },
  { href: "/messages", label: "Messages", glyph: "✉" },
  { href: "/dates", label: "Dates", glyph: "☕" },
  { href: "/you", label: "You", glyph: "◯" },
];

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const pathname = usePathname();
  const { me } = useAuth();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => get<{ unread: number }>("/notifications"), enabled: !!me, refetchInterval: 30_000 });
  const unread = data?.unread ?? 0;
  const isStaff = me?.roles.some((r) => r !== "member");
  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/today" className="text-lg font-bold tracking-tight text-ink">
            Matchmaker
          </Link>
          <nav aria-label="Global" className="flex items-center gap-1">
            {isStaff && (
              <Link href="/admin" className="rounded-full px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-muted">
                Console
              </Link>
            )}
            <Link href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-full px-3 py-2 text-ink-secondary hover:bg-surface-muted">
              <span aria-hidden>🔔</span>
              {unread > 0 && <span aria-hidden className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-caution" />}
            </Link>
            <Link href="/safety" className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-ink/90" aria-label="Safety Center: get help, report or block">
              <span aria-hidden>🛡</span> Safety
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6">
        {title && <h1 className="sr-only">{title}</h1>}
        {children}
      </main>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-3xl">
          {TABS.map((t) => {
            const active = pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <li key={t.href} className="flex-1">
                <Link href={t.href} aria-current={active ? "page" : undefined} className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold", active ? "text-action" : "text-ink-secondary")}>
                  <span aria-hidden className="text-lg leading-none">{t.glyph}</span>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function OnboardingShell({ children, step, total = 8 }: { children: React.ReactNode; step: number; total?: number }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
          <span className="text-lg font-bold tracking-tight text-ink">Matchmaker</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-secondary">
              Step {step} of {total}
            </span>
            <Link href="/safety" className="rounded-full bg-ink px-3 py-1.5 text-sm font-semibold text-white" aria-label="Safety Center">
              🛡 Safety
            </Link>
          </div>
        </div>
        <div className="h-1 w-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={step} aria-label="Onboarding progress">
          <div className="h-1 bg-action transition-all" style={{ width: `${(step / total) * 100}%` }} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-6">{children}</main>
    </div>
  );
}
