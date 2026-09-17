"use client";

import Link from "next/link";
import { Card, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

/* ---------- Types ---------- */
export type Emergency = { number: string; note: string };
export type SafetyCenter = {
  emergency: Emergency;
  disclaimer: string;
  actions: { key: string; label: string; path: string }[];
  education: string[];
  categories: { key: string; severity: string }[];
  open_cases: number;
  blocks: number;
};
export type SafetyCase = {
  id: string;
  receipt_code: string;
  category: string;
  severity: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  protection_applied: string[];
  response_target: string;
  evidence_count: number;
  updates: { at: string; note: string }[];
  resolution_code: string | null;
  support: { emergency: Emergency; note: string };
};

/* ---------- Trauma-informed labels (mirror REPORT_CATEGORIES on the API) ---------- */
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
  rude_or_disrespectful: { label: "Rude or disrespectful", help: "Unkind but not dangerous behaviour." },
  other: { label: "Something else", help: "You can describe it in your own words, or skip." },
};

export const SEVERITY_LABEL: Record<string, string> = { P0: "Immediate", P1: "Severe", P2: "Abuse or fraud", P3: "Conduct or quality" };
export const CASE_STATUS_LABEL: Record<string, string> = { submitted: "Received", triaged: "Received and triaged", assigned: "With a reviewer", in_review: "Under review", awaiting_information: "Waiting for information from you", actioned: "Action taken", appealed: "Under appeal", closed: "Closed" };
export const PROTECTION_LABEL: Record<string, string> = { contact_separated: "Contact separated: they can no longer reach you here", account_restricted: "The reported account is restricted while we review" };

export function SeverityTag({ severity }: { severity: string }) {
  const tone = severity === "P0" || severity === "P1" ? "bg-caution-soft text-caution" : severity === "P2" ? "bg-context-soft text-context" : "bg-surface-muted text-ink-secondary";
  return (
    <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", tone)}>
      {severity} · {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

/* ---------- Emergency: prominent, honest ---------- */
export function EmergencyCard({ emergency, disclaimer }: { emergency: Emergency; disclaimer?: string }) {
  return (
    <Card className="mb-4 border-caution bg-caution-soft" aria-labelledby="emergency-heading">
      <h2 id="emergency-heading" className="font-bold text-ink">
        In immediate danger?
      </h2>
      <a href={`tel:${emergency.number}`} className="mt-2 inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-caution px-5 py-3 text-lg font-bold text-white" aria-label={`Call ${emergency.number}, local emergency services`}>
        <span aria-hidden>☎</span> Call {emergency.number}
      </a>
      <p className="mt-2 text-sm text-ink-secondary">{emergency.note}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{disclaimer ?? "This app is not an emergency service. Contact local emergency services first."}</p>
    </Card>
  );
}

/* ---------- Leave safely: one tap to a neutral page; in-memory form state is dropped ---------- */
export function LeaveSafely({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.location.replace("https://www.google.com");
        } catch {
          /* ignore */
        }
      }}
      className={cx("inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-muted", className)}
      aria-label="Leave safely: exit to a neutral website right away. Nothing unsent is kept."
    >
      <span aria-hidden>↗</span> Leave safely
    </button>
  );
}

export function CaseCard({ c }: { c: SafetyCase }) {
  const cat = CATEGORY_LABEL[c.category]?.label ?? c.category;
  return (
    <Card as="li" className="p-0">
      <Link href={`/safety/cases/${c.id}`} className="block p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-ink">Receipt {c.receipt_code}</span>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary">{CASE_STATUS_LABEL[c.status] ?? c.status}</span>
        </div>
        <p className="text-ink">{cat}</p>
        <p className="text-sm text-ink-secondary">
          Submitted {formatDateTime(c.submitted_at)} · {c.response_target}
        </p>
      </Link>
    </Card>
  );
}
