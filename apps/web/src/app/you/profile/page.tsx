"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, MediaImage, PageTitle, Skeleton, VerificationBadge, cx } from "@/components/ui";
import { ProfileEditor } from "@/components/profile/ProfileEditor";
import { INTENT_LABEL, LANG_LABEL } from "@/lib/format";

type Media = { id: string; type: string; position: number; alt_text: string | null; moderation_status: string; upload_state: string; url: string | null };
type OwnProfile = {
  member_id: string;
  display_name: string | null;
  pronouns: string | null;
  occupation: string | null;
  bio: string | null;
  languages: string[];
  prompts: { key: string; answer: string }[];
  available_prompts: { key: string; label: string }[];
  intent: string | null;
  city: string | null;
  zone: string | null;
  age: number | null;
  media: Media[];
  moderation_status: string;
  completeness: number;
  visibility_map: Record<string, string>;
  version: number;
};

const VIS_LABEL: Record<string, { label: string; help: string }> = {
  public: { label: "Public", help: "Shown to people you're introduced to." },
  matching_only: { label: "Matching only", help: "Used to choose and explain introductions. Never shown." },
  matching_only_private: { label: "Matching only · private", help: "Used only for your own future matching. Never shown." },
  private: { label: "Private", help: "Account use only." },
  safety_only: { label: "Safety only", help: "Restricted safety team. Never in matching." },
  never_stored: { label: "Never stored", help: "Handled by the verification vendor; we keep a result only." },
};

/** Y01 Profile preview & edit: the exact profile matches see, plus which fields are public, private or matching-only. */
export default function YouProfilePage() {
  const { me } = useRequireMember();
  const [tab, setTab] = useState<"preview" | "edit" | "visibility">("preview");
  const q = useQuery({ queryKey: ["profile"], queryFn: () => get<OwnProfile>("/profile"), enabled: !!me });
  const p = q.data;
  const photos = p?.media.filter((m) => m.type === "photo" && m.url) ?? [];

  return (
    <AppShell>
      <PageTitle eyebrow="You · Profile" title="Your profile" lede="Facts and self-expression, shown exactly as an introduction sees them. No beauty score, no ranking." />
      <div role="tablist" aria-label="Profile views" className="mb-4 flex gap-1 rounded-[var(--radius-lg)] border border-border bg-surface p-1">
        {(["preview", "edit", "visibility"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={cx("flex-1 rounded-[var(--radius-md)] px-3 py-2 text-sm font-semibold capitalize", tab === t ? "bg-ink text-white" : "text-ink-secondary")}>
            {t === "preview" ? "As matches see it" : t === "edit" ? "Edit" : "Who sees what"}
          </button>
        ))}
      </div>
      {q.isLoading && <Skeleton lines={6} label="Loading your profile" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {tab === "preview" && p && me && (
        <Card as="article" className="mb-4">
          {photos.length > 0 ? (
            <div className="mb-4 grid grid-cols-2 gap-2">
              {photos.map((m) => (
                <div key={m.id} className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-md)] bg-surface-muted">
                  <MediaImage url={m.url as string} alt={m.alt_text ?? "Your photo"} />
                  {m.moderation_status !== "approved" && <span className="absolute left-2 top-2 rounded bg-surface/90 px-2 py-0.5 text-xs font-semibold">In review · not yet shown</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="mb-4 rounded-[var(--radius-md)] bg-surface-muted p-4 text-sm text-ink-secondary">No photos yet. Introductions open with your prompts and voice, but photos help people recognise you at the venue.</p>
          )}
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-ink">
              {p.display_name ?? "Your name"}
              {p.age ? `, ${p.age}` : ""}
            </h2>
            <VerificationBadge verified={me.verification_status === "verified"} small />
          </div>
          <p className="text-sm text-ink-secondary">
            {[p.pronouns, p.occupation, p.city].filter(Boolean).join(" · ")}
            {p.zone ? ` · ${p.zone} area` : ""}
          </p>
          <p className="mt-1 text-sm text-ink-secondary">{p.intent ? `Looking for: ${INTENT_LABEL[p.intent] ?? p.intent}` : ""}</p>
          {p.languages.length > 0 && <p className="mt-1 text-sm text-ink-secondary">Speaks {p.languages.map((l) => LANG_LABEL[l] ?? l).join(", ")}</p>}
          {p.bio && <p className="mt-3 text-ink">{p.bio}</p>}
          {p.prompts.length > 0 && (
            <ul className="mt-3 space-y-2">
              {p.prompts.map((pr) => (
                <li key={pr.key} className="rounded-[var(--radius-md)] bg-surface-muted p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-context">{p.available_prompts.find((a) => a.key === pr.key)?.label ?? pr.key}…</p>
                  <p className="text-ink">{pr.answer}</p>
                </li>
              ))}
            </ul>
          )}
          {p.media.some((m) => m.type === "voice") && <p className="mt-3 text-sm text-ink-secondary">🎤 Voice note included</p>}
          <p className="mt-4 text-xs text-ink-tertiary">Introductions also see your coarse distance band. They never see your exact location, email, birth date, Blueprint or preferences.</p>
          <Button variant="secondary" className="mt-3" onClick={() => setTab("edit")}>
            Edit my profile
          </Button>
        </Card>
      )}
      {tab === "edit" && <ProfileEditor onSaved={() => q.refetch()} />}
      {tab === "visibility" && p && (
        <Card>
          <h2 className="mb-1 font-bold">Who sees what</h2>
          <p className="mb-3 text-sm text-ink-secondary">Declared at the point of collection and enforced by the API, not just the interface.</p>
          <ul className="divide-y divide-border">
            {Object.entries(p.visibility_map).map(([field, vis]) => (
              <li key={field} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="text-ink">{field.replace(/_/g, " ")}</span>
                <span className="text-right">
                  <span className="block font-semibold text-ink">{VIS_LABEL[vis]?.label ?? vis}</span>
                  <span className="block text-xs text-ink-tertiary">{VIS_LABEL[vis]?.help ?? ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}
