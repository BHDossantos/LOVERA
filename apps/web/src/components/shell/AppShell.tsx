"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cx } from "@/components/ui";

/**
 * The tab icons, drawn rather than typed.
 *
 * They used to be the characters ◎ ✦ ✉ ☕ ◯, which is five different things: two geometric
 * shapes, a dingbat, a text symbol and an emoji. Every platform renders them at a different
 * weight and the coffee cup arrives in full colour on Android, so the bar read as five unrelated
 * glyphs rather than one set — the most visible "this was not designed" tell in the app. Stroked
 * paths on a 24-grid cost nothing and inherit `currentColor`.
 */
const ICON: Record<string, string> = {
  today: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z",
  introductions: "M9.5 6.5a5 5 0 100 11 5 5 0 000-11zM14.5 6.5a5 5 0 110 11",
  messages: "M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7a2.5 2.5 0 01-2.5 2.5H9l-5 4v-4z",
  dates: "M7 3v3M17 3v3M3.5 9.5h17M5 6.5h14a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0119 19.5H5A1.5 1.5 0 013.5 18V8A1.5 1.5 0 015 6.5z",
  you: "M12 4a3.75 3.75 0 100 7.5A3.75 3.75 0 0012 4zM4.5 20a7.5 7.5 0 0115 0",
  bell: "M12 3a5.5 5.5 0 00-5.5 5.5c0 4-1.5 5.5-1.5 5.5h14s-1.5-1.5-1.5-5.5A5.5 5.5 0 0012 3zM10 18a2 2 0 004 0",
  shield: "M12 3l7 2.8v5.1c0 4.3-2.9 8.2-7 9.6-4.1-1.4-7-5.3-7-9.6V5.8z",
};

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className ?? "h-6 w-6"}>
      <path d={ICON[name]} />
    </svg>
  );
}

const TABS = [
  { href: "/today", label: "Today", icon: "today" },
  { href: "/introductions", label: "Introductions", icon: "introductions" },
  { href: "/messages", label: "Messages", icon: "messages" },
  { href: "/dates", label: "Dates", icon: "dates" },
  { href: "/you", label: "You", icon: "you" },
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
          <Link href="/today" className="flex items-center gap-2 text-ink" aria-label="Matchmaker, home">
            <Icon name="introductions" className="h-6 w-6 text-action" />
            <span className="display text-xl font-bold tracking-tight">Matchmaker</span>
          </Link>
          <nav aria-label="Global" className="flex items-center gap-1">
            {isStaff && (
              <Link href="/admin" className="rounded-full px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-muted">
                Console
              </Link>
            )}
            <Link href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-full px-3 py-2 text-ink-secondary hover:bg-surface-muted">
              <Icon name="bell" className="h-5 w-5" />
              {unread > 0 && <span aria-hidden className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-caution" />}
            </Link>
            <Link href="/safety" className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-2 text-sm font-semibold text-ink-inverse hover:bg-ink/90" aria-label="Safety Center: get help, report or block">
              <Icon name="shield" className="h-4 w-4" /> Safety
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
                  <Icon name={t.icon} className="h-6 w-6" />
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
          <span className="display text-xl font-bold tracking-tight text-ink">Matchmaker</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-secondary">
              Step {step} of {total}
            </span>
            <Link href="/safety" className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-sm font-semibold text-ink-inverse" aria-label="Safety Center">
              <Icon name="shield" className="h-4 w-4" /> Safety
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
