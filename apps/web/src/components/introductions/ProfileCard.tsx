"use client";

import { useState } from "react";
import { INTENT_LABEL, LANG_LABEL } from "@/lib/format";
import type { ProfileSnapshot } from "@/lib/types";
import { Card, MediaImage, VerificationBadge, cx } from "@/components/ui";
import { PROMPT_LABEL, distanceLabel } from "./types";

/** One complete profile card. Public facts only; no like counts, rank or scores. */
export function ProfileCard({ profile, compact }: { profile: ProfileSnapshot; compact?: boolean }) {
  const photos = profile.media.filter((m) => m.url);
  const [index, setIndex] = useState(0);
  const current = photos[index] ?? photos[0];
  const facts: string[] = [];
  if (profile.age) facts.push(`${profile.age}`);
  if (profile.pronouns) facts.push(profile.pronouns);
  if (profile.city) facts.push(profile.city);
  facts.push(distanceLabel(profile.distance_band_km));
  return (
    <Card as="article" className="overflow-hidden p-0" aria-label={`${profile.display_name}'s profile`}>
      {current?.url ? (
        <figure className="m-0">
          <div className="aspect-[4/5] w-full bg-surface-muted">
            <MediaImage url={current.url} alt={current.alt_text || `${profile.display_name}'s photo ${index + 1} of ${photos.length}`} />
          </div>
          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto p-3" role="group" aria-label="Choose a photo">
              {photos.map((p, i) => (
                <button key={p.id} type="button" aria-label={`Show photo ${i + 1} of ${photos.length}`} aria-pressed={i === index} onClick={() => setIndex(i)} className={cx("h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-md)] border-2", i === index ? "border-action" : "border-transparent")}>
                  <MediaImage url={p.url as string} alt="" />
                </button>
              ))}
            </div>
          )}
        </figure>
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center bg-surface-muted text-ink-tertiary">No approved photo yet</div>
      )}
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-ink">{profile.display_name}</h2>
          <VerificationBadge verified={profile.verified} small />
        </div>
        <p className="mt-1 text-ink-secondary">{facts.join(" · ")}</p>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {profile.intent && (
            <div>
              <dt className="text-ink-tertiary">Looking for</dt>
              <dd className="font-medium text-ink">{INTENT_LABEL[profile.intent] ?? profile.intent}</dd>
            </div>
          )}
          {profile.languages && profile.languages.length > 0 && (
            <div>
              <dt className="text-ink-tertiary">Languages</dt>
              <dd className="font-medium text-ink">{profile.languages.map((l) => LANG_LABEL[l] ?? l).join(", ")}</dd>
            </div>
          )}
          {profile.occupation && (
            <div>
              <dt className="text-ink-tertiary">Work</dt>
              <dd className="font-medium text-ink">{profile.occupation}</dd>
            </div>
          )}
        </dl>
        {!compact && profile.bio && <p className="mt-4 text-ink">{profile.bio}</p>}
        {!compact && profile.prompts && profile.prompts.length > 0 && (
          <ul className="mt-4 space-y-3">
            {profile.prompts.map((p) => (
              <li key={p.key} className="rounded-[var(--radius-lg)] bg-surface-muted p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-context">{PROMPT_LABEL[p.key] ?? p.key}</p>
                <p className="mt-1 text-ink">{p.answer}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
