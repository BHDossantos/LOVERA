export function formatDateTime(iso: string | null | undefined, tz?: string, locale = "en-GB") {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function formatDate(iso: string | null | undefined, locale = "en-GB") {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export function hoursLeft(iso: string | null | undefined) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.round(ms / 3_600_000));
}

export function relative(iso: string | null | undefined) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const LANG_LABEL: Record<string, string> = { en: "English", it: "Italiano", es: "Español", pt: "Português", fr: "Français", de: "Deutsch", ca: "Català", other: "Other" };
export const INTENT_LABEL: Record<string, string> = { long_term: "Long-term relationship", life_partner: "Life partner" };
export const STRENGTH_LABEL: Record<string, string> = { strong: "Strong evidence", promising: "Promising", low_evidence: "Low evidence" };
export const TIER_LABEL: Record<string, string> = { must: "Must", prefer: "Prefer", open: "Open" };
export const euro = (cents: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);

/* ---------- When a date happens ----------
 *
 * Two kinds of timestamp live in this app and they do not want the same zone.
 *
 * Most of them are a record of something that already happened — a message sent, a case submitted,
 * a plan proposed. Those belong in the zone the person reading is in, which is what
 * `formatDateTime(iso)` with no zone gives.
 *
 * A date is the other kind. It is a physical meeting at a venue, so "19:00" means 19:00 on the
 * venue's clock: that is the time the table is booked for and the time to turn up by. The API sends
 * that zone as `plan.timezone` (the venue's market, not either member's setting). So the date's own
 * time is rendered there, with the zone *named* — the detail and confirmation screens used to show a
 * bare clock reading, and the web app and the mobile app did not even agree which zone it was in:
 * web used the plan's, mobile used the device's via `toLocaleString()`. Two apps, one date, two
 * different clock faces, neither of them labelled.
 *
 * And because a member can be somewhere else when they read it, `alsoYours` carries the same instant
 * on their own clock whenever that reads differently. Both halves matter: the venue's time is what
 * they are agreeing to, their own is what their alarm needs to be set to.
 */

const PLAN_PARTS = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;

/** The viewer's own zone, or undefined where `Intl` cannot say — in which case we claim nothing. */
function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function render(when: Date, tz: string | undefined, locale: string, named: boolean): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...PLAN_PARTS, timeZone: tz, ...(named ? { timeZoneName: "short" as const } : {}) }).format(when);
  } catch {
    return when.toLocaleString();
  }
}

/**
 * `at` is the date on the venue's clock with the zone named; `alsoYours` is the same instant on the
 * reader's clock, or null when that would say the same thing.
 *
 * `viewer` defaults to the device's zone and exists to be passed: a test cannot move the device —
 * under jest `process.env.TZ` does not reach `Intl`, which froze every assertion at UTC — and a
 * screen that wanted to render for the member's *account* zone rather than the handset's now can.
 */
export function formatPlanTime(
  iso: string | null | undefined,
  tz?: string | null,
  viewer: string | undefined = deviceZone(),
  locale = "en-GB",
): { at: string; alsoYours: string | null } {
  if (!iso) return { at: "", alsoYours: null };
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return { at: "", alsoYours: null };
  const zone = tz || undefined;
  // A plan with no zone yet — a draft, before a venue is chosen — has only one honest reading: the
  // reader's own clock. Naming their own zone back to them is noise, so it is not named.
  if (!zone) return { at: render(when, viewer, locale, false), alsoYours: null };
  // A venue zone but no readable viewer zone: show the venue's, named, and claim nothing about theirs.
  if (!viewer) return { at: render(when, zone, locale, true), alsoYours: null };
  const there = render(when, zone, locale, false);
  const here = render(when, viewer, locale, false);
  return { at: render(when, zone, locale, true), alsoYours: here === there ? null : `${here} your time` };
}

/** The same thing as one string, for places that cannot lay out two lines. */
export function planTimeLine(iso: string | null | undefined, tz?: string | null, viewer?: string, locale = "en-GB"): string {
  const { at, alsoYours } = formatPlanTime(iso, tz, viewer ?? deviceZone(), locale);
  return alsoYours ? `${at} · ${alsoYours}` : at;
}
