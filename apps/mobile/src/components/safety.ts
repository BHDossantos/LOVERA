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
export type SafetyCenter = {
  categories: { key: string; severity: string }[];
  cases: SafetyCase[];
  blocks: { id: string; display_name: string }[];
  emergency: string;
};
