"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { EmptyState, LinkButton, Skeleton, cx } from "@/components/ui";

export type StaffRole = "concierge" | "safety_reviewer" | "support" | "admin";
export const STAFF_ROLES: StaffRole[] = ["concierge", "safety_reviewer", "support", "admin"];

const NAV: { href: string; label: string; roles: StaffRole[] }[] = [
  { href: "/admin", label: "Overview", roles: STAFF_ROLES },
  { href: "/admin/matching", label: "Matching", roles: ["concierge", "admin"] },
  { href: "/admin/verification", label: "Verification", roles: ["safety_reviewer", "admin"] },
  { href: "/admin/safety", label: "Safety cases", roles: ["safety_reviewer", "admin"] },
  { href: "/admin/safety/appeals", label: "Appeals", roles: ["safety_reviewer", "admin"] },
  { href: "/admin/members", label: "Members", roles: ["support", "concierge", "safety_reviewer", "admin"] },
  { href: "/admin/audit", label: "Audit", roles: ["admin"] },
];

export function hasAnyRole(roles: string[] | undefined, allowed: StaffRole[]) {
  if (!roles) return false;
  return roles.includes("admin") || allowed.some((r) => roles.includes(r));
}

/** Staff console layout. Role-gated client-side (the API enforces the real boundary). Never uses the member onboarding guard: staff accounts may be incomplete members. */
export function AdminShell({ children, title, roles }: { children: ReactNode; title: string; roles: StaffRole[] }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !me) router.replace("/welcome");
  }, [loading, me, router]);

  const allowed = hasAnyRole(me?.roles, roles);
  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-lg font-bold tracking-tight text-ink">
              Console
            </Link>
            <span className="rounded-full bg-context-soft px-2 py-0.5 text-xs font-semibold text-context">Staff · every sensitive read is audited</span>
          </div>
          <Link href="/today" className="rounded-full px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-muted">
            ← Back to the app
          </Link>
        </div>
        <nav aria-label="Console workspaces" className="mx-auto max-w-5xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2">
            {NAV.filter((n) => hasAnyRole(me?.roles, n.roles)).map((n) => {
              const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href) && !(n.href === "/admin/safety" && pathname.startsWith("/admin/safety/appeals"));
              return (
                <li key={n.href}>
                  <Link href={n.href} aria-current={active ? "page" : undefined} className={cx("inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-sm font-semibold", active ? "bg-ink text-white" : "text-ink-secondary hover:bg-surface-muted")}>
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
        <h1 className="mb-4 text-2xl font-bold text-ink">{title}</h1>
        {loading || !me ? (
          <Skeleton lines={4} />
        ) : allowed ? (
          children
        ) : (
          <EmptyState title="FORBIDDEN: this workspace is not part of your role" body={`Your roles: ${me.roles.join(", ")}. Access is granted by an administrator and every attempt is logged.`} action={<LinkButton href="/today" variant="secondary">Back to the app</LinkButton>} />
        )}
      </main>
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <p className="text-sm text-ink-secondary">{label}</p>
      <p className="text-2xl font-bold text-ink">{value}</p>
      {hint && <p className="text-xs text-ink-tertiary">{hint}</p>}
    </div>
  );
}

export function Table({ headers, children, caption }: { headers: string[]; children: ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-secondary">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx("px-3 py-2 align-top text-ink", className)}>{children}</td>;
}
