import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Legal · AI Matchmaker",
  description: "Terms of Service, Privacy Notice and Community Agreement.",
};

const DOCS = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/community", label: "Community" },
];

/**
 * Public, unauthenticated, and deliberately outside the member shell: both stores
 * require a privacy policy reachable by a reviewer who has not signed up, and a member
 * deciding whether to trust us should not have to hand over an email address first.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-4 py-4">
          <Link href="/welcome" className="font-bold text-ink">
            AI Matchmaker
          </Link>
          <nav className="flex gap-4 text-sm">
            {DOCS.map((d) => (
              <Link key={d.href} href={d.href} className="text-action hover:underline">
                {d.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <article className="prose-legal">{children}</article>
      </main>
    </div>
  );
}
