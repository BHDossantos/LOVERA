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

/** Marks a value the operator must fill in before launch, and makes it obvious on the page. */
export function TODO({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded bg-caution-soft px-1 font-semibold text-caution">[{children}]</mark>
  );
}
