"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { STRENGTH_LABEL, TIER_LABEL } from "@/lib/format";
import type { Strength } from "@/lib/types";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Buttons ---------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; fullWidth?: boolean; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "sm" };

const VARIANT: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-action text-ink-inverse hover:bg-action-strong border border-transparent shadow-[0_4px_12px_rgba(143,34,68,0.28)]",
  secondary: "bg-surface text-ink border border-border-strong hover:bg-surface-muted",
  ghost: "bg-transparent text-action hover:bg-action-soft border border-transparent",
  danger: "bg-surface text-caution border border-caution hover:bg-caution-soft",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ loading, fullWidth, variant = "primary", size = "md", className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60", size === "md" ? "px-5 py-3 text-base" : "px-3 py-2 text-sm min-h-11", VARIANT[variant], fullWidth && "w-full", className)}
      {...rest}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      <span>{loading ? "Working…" : children}</span>
    </button>
  );
});

export function LinkButton({ href, children, variant = "primary", fullWidth, className }: { href: string; children: ReactNode; variant?: ButtonProps["variant"]; fullWidth?: boolean; className?: string }) {
  return (
    <Link href={href} className={cx("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] px-5 py-3 text-base font-semibold transition-colors", VARIANT[variant ?? "primary"], fullWidth && "w-full", className)}>
      {children}
    </Link>
  );
}

/* ---------- Layout ---------- */

/**
 * The warm hero band, for the top of a page that has to make a first impression.
 *
 * It bleeds past the page gutter on purpose — a wash that stops short of the edge reads as a
 * mistake — so it takes negative margins matching the shell's padding. The title is the serif
 * display face, which is most of the difference between "a product" and "a form with a heading
 * above it", and costs one font name.
 */
export function Hero({ eyebrow, title, lede, children }: { eyebrow?: string; title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="hero-wash -mx-4 -mt-4 mb-8 rounded-b-[var(--radius-xl)] px-6 py-12 sm:-mx-6 sm:-mt-6 sm:px-10 sm:py-16">
      <div className="relative">
        {eyebrow && <p className="mb-3 text-xs font-bold uppercase tracking-[0.09em] text-action-strong">{eyebrow}</p>}
        <h1 className="display max-w-2xl text-4xl font-bold leading-[1.08] text-ink sm:text-5xl">{title}</h1>
        {lede && <p className="mt-4 max-w-xl text-lg text-ink-secondary">{lede}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}

export function Card({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "article" | "div" | "li" } & Record<string, unknown>) {
  return (
    <Tag className={cx("rounded-[var(--radius-xl)] border border-border bg-surface p-5 shadow-[var(--shadow-raised)]", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function PageTitle({ eyebrow, title, lede }: { eyebrow?: string; title: string; lede?: ReactNode }) {
  return (
    <header className="mb-6">
      {/* Rose, not the gold it was: gold on the canvas gave 2.9:1 at this size, a WCAG AA failure
          on the line above the title of every screen, and the brand colour is the thing a member
          should see first anyway. */}
      {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-[0.09em] text-action">{eyebrow}</p>}
      <h1 className="display text-3xl font-bold leading-tight text-ink sm:text-4xl">{title}</h1>
      {lede && <p className="mt-2 text-base text-ink-secondary">{lede}</p>}
    </header>
  );
}

export function Field({ label, help, error, children, htmlFor }: { label: string; help?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {help && !error && <p className="mt-1 text-sm text-ink-tertiary">{help}</p>}
      {error && (
        <p className="mt-1 text-sm text-caution" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function TextInput({ className, invalid, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx("w-full rounded-[var(--radius-md)] border bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-tertiary", invalid ? "border-caution" : "border-border", className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function TextArea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cx("w-full rounded-[var(--radius-md)] border bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-tertiary", invalid ? "border-caution" : "border-border", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("w-full rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-base text-ink", className)} {...rest}>
      {children}
    </select>
  );
}

/* ---------- ChoiceCard: whole card selectable, role announced ---------- */
export function ChoiceCard({ title, body, badge, selected, disabled, onSelect, name }: { title: string; body?: string; badge?: string; selected: boolean; disabled?: boolean; onSelect: () => void; name?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      name={name}
      disabled={disabled}
      onClick={onSelect}
      className={cx("flex w-full items-start gap-3 rounded-[var(--radius-lg)] border p-4 text-left transition-colors", selected ? "border-action bg-action-soft" : "border-border bg-surface hover:bg-surface-muted", disabled && "opacity-50")}
    >
      <span aria-hidden className={cx("mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-action bg-action" : "border-ink-tertiary")}>{selected && <span className="h-2 w-2 rounded-full bg-white" />}</span>
      <span className="flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        {body && <span className="mt-0.5 block text-sm text-ink-secondary">{body}</span>}
      </span>
      {badge && <span className="rounded-full bg-context-soft px-2 py-0.5 text-xs font-semibold text-context">{badge}</span>}
    </button>
  );
}

/* ---------- Status banner: one action, never hides safety ---------- */
export function StatusBanner({ type = "info", title, body, action }: { type?: "info" | "caution" | "error" | "success"; title: string; body?: ReactNode; action?: ReactNode }) {
  // The accent is the 4px left edge; the other three sides are the ordinary hairline. Drawing
  // all four in the tone colour framed every banner in a heavy box, which is a lot of shouting
  // for a sentence that is usually just context.
  const tone = { info: "bg-action-soft border-l-action", caution: "bg-context-soft border-l-context", error: "bg-caution-soft border-l-caution", success: "bg-success-soft border-l-success" }[type];
  const icon = { info: "ℹ", caution: "⚠", error: "✕", success: "✓" }[type];
  return (
    <div role={type === "error" ? "alert" : "status"} className={cx("mb-4 flex gap-3 rounded-[var(--radius-lg)] border border-border border-l-4 p-4 text-ink", tone)}>
      <span aria-hidden className="text-lg leading-none">{icon}</span>
      <div className="flex-1">
        <p className="font-semibold">{title}</p>
        {body && <div className="mt-1 text-sm text-ink-secondary">{body}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/* ---------- Evidence labels: text plus icon, never colour alone ---------- */
export function EvidenceLabel({ strength }: { strength: Strength }) {
  const tone = { strong: "bg-success-soft text-success", promising: "bg-context-soft text-context", low_evidence: "bg-surface-muted text-ink-secondary" }[strength];
  const glyph = { strong: "●●●", promising: "●●○", low_evidence: "●○○" }[strength];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", tone)}>
      <span aria-hidden>{glyph}</span>
      {STRENGTH_LABEL[strength]}
    </span>
  );
}

export function MatchReason({ label, strength, text }: { label: string; strength: Strength; text: string }) {
  return (
    <li className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-ink">{label}</span>
        <EvidenceLabel strength={strength} />
      </div>
      <p className="text-ink-secondary">{text}</p>
    </li>
  );
}

export function VerificationBadge({ verified, small }: { verified: boolean; small?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full font-semibold", verified ? "bg-success-soft text-success" : "bg-surface-muted text-ink-secondary", small ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm")} title={verified ? "Identity and 18+ checked by the verification vendor. Not a background check." : "Not yet verified"}>
      <span aria-hidden>{verified ? "✓" : "○"}</span>
      {verified ? "Verified" : "Unverified"}
    </span>
  );
}

export function TierPill({ tier }: { tier: string }) {
  const tone = { must: "bg-ink text-white", prefer: "bg-action-soft text-action", open: "bg-surface-muted text-ink-secondary" }[tier] ?? "bg-surface-muted";
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", tone)}>{TIER_LABEL[tier] ?? tier}</span>;
}

export function TierSelect({ value, onChange, name }: { value: string; onChange: (v: string) => void; name?: string }) {
  return (
    <div role="radiogroup" aria-label="Preference tier" className="flex gap-2">
      {(["must", "prefer", "open"] as const).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} name={name} onClick={() => onChange(t)} className={cx("flex-1 rounded-[var(--radius-md)] border px-3 py-2 text-sm font-semibold", value === t ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
          {TIER_LABEL[t]}
          <span className="block text-xs font-normal">{{ must: "Hard gate", prefer: "Weighted", open: "Light" }[t]}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Skeleton and empty states ---------- */
export function Skeleton({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} aria-hidden className="skeleton h-5" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-xl)] border border-dashed border-border bg-surface p-8 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      {body && <div className="mt-2 text-ink-secondary">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: { code?: string; message?: string; body?: { retryable?: boolean; message?: string; code?: string } } | null; retry?: () => void }) {
  if (!error) return null;
  const code = error.body?.code ?? error.code ?? "ERROR";
  const message = error.body?.message ?? error.message ?? "Something went wrong.";
  const map: Record<string, string> = {
    OFFLINE: "You're offline. Your draft is kept; nothing was sent.",
    AI_UNAVAILABLE: "The AI assistant is unavailable. Manual messaging, safety and account controls still work.",
    DEPENDENCY_UNAVAILABLE: "A service we depend on is down. Retry in a moment; your data is safe.",
    SAFETY_HOLD: "This conversation is paused while our safety team reviews a report.",
    VERSION_MISMATCH: "This changed elsewhere. Reload to see the latest before trying again.",
    INVENTORY_UNAVAILABLE: "No qualified introduction is available right now. Your credit is protected.",
  };
  return <StatusBanner type="error" title={map[code] ?? message} body={map[code] ? message : undefined} action={retry && (error.body?.retryable ?? true) ? <Button size="sm" variant="secondary" onClick={retry}>Try again</Button> : undefined} />;
}

/* ---------- Media ---------- */
export function Avatar({ name, url, size = 48 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--wash-2)] font-semibold text-action-strong" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }} aria-label={`${name}'s photo`}>
      {url ? <MediaImage url={url} alt={`${name}'s photo`} /> : initials}
    </span>
  );
}

import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/api";

export function MediaImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api${url.replace(/^\/v1/, "")}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } })
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => alive && setSrc(t))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [url]);
  if (!src) return <span aria-hidden className="skeleton block h-full w-full" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={cx("h-full w-full object-cover", className)} />;
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-xl)] bg-surface p-5 sm:rounded-[var(--radius-xl)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full px-3 text-ink-secondary hover:bg-surface-muted">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block font-semibold text-ink">{label}</span>
        {description && <span className="block text-sm text-ink-secondary">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx("relative h-7 w-12 shrink-0 rounded-full border transition-colors", checked ? "border-action bg-action" : "border-border bg-surface-muted")}>
        <span className={cx("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
        <span className="sr-only">{checked ? "On" : "Off"}</span>
      </button>
    </label>
  );
}

export function KeyValue({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border">
      {items.map((i) => (
        <div key={i.k} className="flex justify-between gap-4 py-2 text-sm">
          <dt className="text-ink-secondary">{i.k}</dt>
          <dd className="text-right font-medium text-ink">{i.v}</dd>
        </div>
      ))}
    </dl>
  );
}
