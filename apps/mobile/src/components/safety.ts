/** Mirrors apps/web/src/components/safety/shared.tsx. */
export const CATEGORY_LABEL: Record<string, { label: string; help: string }> = {
  imminent_danger: { label: "Someone is in danger right now", help: "Immediate risk to you or another person." },
  child_safety: { label: "A child may be at risk", help: "Any concern involving a minor." },
  sexual_violence: { label: "Sexual violence or assault", help: "Anything sexual that happened without consent." },
  stalking: { label: "Following, watching or showing up uninvited", help: "Unwanted tracking, online or offline." },
  threats: { label: "Threats of harm", help: "Threats against you, someone else, or property." },
  intimate_image_abuse: { label: "Intimate images shared or threatened", help: "Sharing, or threatening to share, private images." },
  extortion: { label: "Demands for money or favours under pressure", help: "Blackmail or coercion for money." },
  harassment: { label: "Harassment or unwanted contact", help: "Repeated contact after being asked to stop, or abuse." },
  coercion: { label: "Pressure to do something I didn't want", help: "Emotional or other pressure to cross a boundary." },
  scam_or_fraud: { label: "Asking for money, crypto or gift cards", help: "Financial requests, investment tips, or suspicious links." },
  impersonation: { label: "Not who they say they are", help: "Fake identity, stolen photos or misrepresented facts." },
  hate_or_discrimination: { label: "Hateful or discriminatory behaviour", help: "Targeting identity, background or beliefs." },
  misleading_profile: { label: "Misleading profile", help: "Photos or facts that don't reflect the person." },
  no_show: { label: "Didn't turn up to a confirmed date", help: "No message, no reschedule." },
};

export const URGENCY = [
  { value: "happening_now", label: "Happening right now", body: "Ongoing or about to happen." },
  { value: "recent", label: "In the last few days" },
  { value: "past", label: "A while ago" },
  { value: "not_urgent", label: "Not urgent", body: "I want it on record." },
];

export type SafetyCase = { id: string; category: string; state: string; opened_at: string; acknowledgement_due_at?: string | null };

/**
 * GET /safety, as the API actually answers it.
 *
 * This type previously claimed `cases` and `blocks` were arrays and `emergency` a string.
 * None of that was true: the endpoint returns counts, no case list at all, and an
 * `{ number, note }` object. `get<SafetyCenter>()` is an unchecked assertion, so nothing
 * complained — the screen read `cases.map` on undefined and dialled `tel:[object Object]`.
 * The lists come from /safety/cases and /blocks, which is also how the web app does it.
 */
export type SafetyCenter = {
  emergency: { number: string; note: string };
  disclaimer: string;
  actions: { key: string; label: string; path: string }[];
  education: string[];
  categories: { key: string; severity: string }[];
  open_cases: number;
  blocks: number;
};
export type Block = { member_id: string; display_name: string; created_at: string };

/**
 * A `tel:` URI needs digits, and the API's emergency fields are written for people:
 * the date plan sends "112 (EU)" and the safety centre an { number, note } object. Dialling
 * either verbatim produces a URI the platform cannot act on, which is a bad way to find out
 * that a button meant for an emergency does nothing.
 */
export function telUri(emergency: string | { number: string } | null | undefined, fallback = "112") {
  const raw = typeof emergency === "string" ? emergency : emergency?.number;
  const digits = (raw ?? fallback).replace(/[^0-9+]/g, "");
  return `tel:${digits || fallback}`;
}
