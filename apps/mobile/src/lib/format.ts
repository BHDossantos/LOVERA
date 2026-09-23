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
