import { FACTS, type FactName } from "./_facts";

export function DocHeader({ title, version, updated }: { title: string; version: string; updated: string }) {
  return (
    <header className="mb-8">
      <h1 className="text-3xl font-bold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-tertiary">
        Version {version} · Last updated {updated}
      </p>
    </header>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 mb-2 text-xl font-bold text-ink">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-ink-secondary">{children}</p>;
}

export function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-ink-secondary">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

/**
 * One operator-specific fact, from `_facts.ts`.
 *
 * Supplied, it renders as ordinary prose. Unsupplied, it renders as a highlighted gap *with what
 * is missing spelled out*, because a legal document with a blank in it should look wrong to
 * everyone — a member, a reviewer and whoever is about to deploy it.
 *
 * This replaced 21 inline `<TODO>` markers. The entity name and the registered address each
 * appeared twice, in the terms and the privacy notice, so filling them in was a search-and-replace
 * that could half-succeed — and a privacy notice naming a controller the terms do not is a document
 * that contradicts itself. `tools/check_legal_facts.py --require-all` is what stops a production
 * build while any of them is still a gap.
 */
export function Fact({ name }: { name: FactName }) {
  const spec = FACTS[name];
  if (spec?.value) return <>{spec.value}</>;
  return (
    <mark className="rounded bg-caution-soft px-1 font-semibold text-caution">
      [not set: {spec?.describe ?? name}]
    </mark>
  );
}
