"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { formatDateTime, planTimeLine } from "@/lib/format";
import { Card, cx } from "@/components/ui";
import type { DatePlan, Venue } from "@/lib/types";

/* ---------- Types shared by the Dates screens ---------- */
export type Overlap = { date: string; weekday: string; start: string; end: string; starts_at: string; ends_at: string };
export type OverlapsOut = { items: Overlap[]; concierge: boolean; note: string };
export type VenuesOut = { items: Venue[]; concierge: boolean; rules: string[] };
export type Outcome = { state: string; mutual: boolean; next_steps?: string[]; conversation_id?: string; message?: string };

export const DATE_STYLES: { value: string; label: string }[] = [
  { value: "coffee", label: "Coffee" },
  { value: "walk", label: "A walk" },
  { value: "drinks", label: "Drinks" },
  { value: "dinner", label: "Dinner" },
  { value: "culture", label: "Museum or show" },
  { value: "activity", label: "An activity" },
];

export const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: "schedule", label: "Schedule changed" },
  { value: "not_feeling_it", label: "Not feeling it" },
  { value: "illness", label: "Unwell" },
  { value: "safety", label: "A safety concern" },
  { value: "other", label: "Something else" },
];

export function useDatePlan(id: string | null | undefined) {
  return useQuery({ queryKey: ["date-plan", id], queryFn: () => get<DatePlan>(`/date-plans/${id}`), enabled: !!id });
}

/** "Sat 18:00" — used inside outcome-describing buttons. */
export function shortWhen(iso: string | null | undefined, tz?: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  } catch {
    return formatDateTime(iso);
  }
}

/** Status text + glyph. Never colour alone. */
export function planStatus(plan: DatePlan): { label: string; glyph: string; tone: string } {
  if (plan.status === "confirmed") return { label: "Confirmed", glyph: "✓", tone: "bg-success-soft text-success" };
  if (plan.status === "cancelled") return { label: "Cancelled", glyph: "✕", tone: "bg-surface-muted text-ink-secondary" };
  if (plan.status === "completed") return { label: "Happened", glyph: "●", tone: "bg-surface-muted text-ink-secondary" };
  if (plan.status === "no_show" || plan.status === "disputed") return { label: "Attendance unclear", glyph: "?", tone: "bg-context-soft text-context" };
  if (plan.status === "proposed" || plan.status === "countered") {
    return plan.awaiting_your_confirmation ? { label: "Needs your answer", glyph: "!", tone: "bg-context-soft text-context" } : { label: `Waiting for ${plan.other_display_name}`, glyph: "…", tone: "bg-action-soft text-action" };
  }
  return { label: "Draft", glyph: "○", tone: "bg-surface-muted text-ink-secondary" };
}

export function StatusChip({ plan }: { plan: DatePlan }) {
  const s = planStatus(plan);
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", s.tone)}>
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  );
}

const ACTION_LABEL: Record<string, string> = { created: "started planning", proposed: "proposed", accept: "confirmed", decline: "asked for another time", cancelled: "cancelled the date" };

/** Who changed what, in order. `by` is a member id; we only ever name "You" or the other person. */
export function PlanHistory({ plan, meId }: { plan: DatePlan; meId: string | null | undefined }) {
  if (!plan.history.length) return null;
  return (
    <ol className="divide-y divide-border text-sm">
      {plan.history.map((h, i) => {
        const who = h.by === meId ? "You" : plan.other_display_name;
        const what = ACTION_LABEL[h.action] ?? h.action;
        const changed = h.changed_fields?.length ? ` (${h.changed_fields.join(" and ")})` : "";
        return (
          <li key={i} className="flex justify-between gap-3 py-2">
            <span className="text-ink">
              <span className="font-semibold">{who}</span> {what}
              {changed}
            </span>
            <time dateTime={h.at} className="shrink-0 text-ink-tertiary">
              {formatDateTime(h.at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

export function DatePlanCard({ plan }: { plan: DatePlan }) {
  const when = plan.starts_at ? planTimeLine(plan.starts_at, plan.timezone) : "Time not chosen yet";
  return (
    <Card as="li" className="p-0">
      <Link href={`/dates/${plan.id}`} className="block p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-ink">{plan.other_display_name}</span>
          <StatusChip plan={plan} />
        </div>
        <p className="text-ink">{when}</p>
        <p className="text-sm text-ink-secondary">{plan.venue ? `${plan.venue.name} · ${plan.venue.coarse_area}` : "Venue not chosen yet"}</p>
        {plan.feedback_open && !plan.feedback_submitted && <p className="mt-2 text-sm font-semibold text-action">Private feedback is open →</p>}
        {plan.status === "confirmed" && !plan.check_in && <p className="mt-2 text-sm text-ink-secondary">No check-in set up yet.</p>}
      </Link>
    </Card>
  );
}

/* ---------- Venue ---------- */
const PRICE_LABEL: Record<string, string> = { free: "Free", "€": "Inexpensive (€)", "€€": "Moderate (€€)", "€€€": "Pricier (€€€)" };
const TRAVEL_LABEL: Record<string, string> = { "0-2": "under 2 km", "2-5": "2–5 km", "5-10": "5–10 km", "10+": "over 10 km" };

export function VenueCard({ venue, selected, onSelect, otherName }: { venue: Venue; selected: boolean; onSelect: () => void; otherName: string }) {
  const access = Object.entries(venue.accessibility)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, " "));
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className={cx("w-full rounded-[var(--radius-lg)] border p-4 text-left transition-colors", selected ? "border-action bg-action-soft" : "border-border bg-surface hover:bg-surface-muted")}>
      <span className="flex items-start gap-3">
        <span aria-hidden className={cx("mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-action bg-action" : "border-ink-tertiary")}>{selected && <span className="h-2 w-2 rounded-full bg-white" />}</span>
        <span className="flex-1">
          <span className="block font-semibold text-ink">{venue.name}</span>
          <span className="block text-sm text-ink-secondary">{venue.coarse_area} · public place</span>
          {venue.atmosphere && <span className="mt-1 block text-sm text-ink">{venue.atmosphere}</span>}
          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
            <span>Price: {PRICE_LABEL[venue.price_band] ?? venue.price_band}</span>
            <span>Access: {access.length ? access.join(", ") : "no step-free access listed"}</span>
          </span>
          {venue.travel && (
            <span className="mt-1 block text-xs text-ink-secondary">
              Travel balance: you {TRAVEL_LABEL[venue.travel.you_km_band] ?? venue.travel.you_km_band}, {otherName} {TRAVEL_LABEL[venue.travel.them_km_band] ?? venue.travel.them_km_band}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/* ---------- Discreet calendar entry (.ics built client-side; no coordinates, discreet title) ---------- */
function icsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildIcs(plan: DatePlan): string | null {
  if (!plan.starts_at) return null;
  const end = plan.ends_at ?? new Date(new Date(plan.starts_at).getTime() + 2 * 3_600_000).toISOString();
  const location = plan.venue ? `${plan.venue.name}, ${plan.venue.coarse_area}` : "";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Matchmaker//Date//EN", "BEGIN:VEVENT", `UID:dateplan-${plan.id}@matchmaker`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(plan.starts_at)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${plan.calendar_title}`, location ? `LOCATION:${location.replace(/,/g, "\\,")}` : "", "END:VEVENT", "END:VCALENDAR"];
  return lines.filter(Boolean).join("\r\n");
}

export function CalendarDownload({ plan }: { plan: DatePlan }) {
  const ics = buildIcs(plan);
  if (!ics) return null;
  const href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  return (
    <a href={href} download={`${plan.calendar_title.replace(/\s+/g, "-").toLowerCase()}.ics`} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-3 text-base font-semibold text-ink hover:bg-surface-muted">
      Add “{plan.calendar_title}” to my calendar
    </a>
  );
}
