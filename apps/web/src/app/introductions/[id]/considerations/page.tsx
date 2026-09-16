"use client";

import { use } from "react";
import { ApiError } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Card, ErrorState, EvidenceLabel, LinkButton } from "@/components/ui";
import { CorrectionForm } from "@/components/introductions/CorrectionForm";
import { IntroductionHeader } from "@/components/introductions/IntroductionHeader";
import { IntroductionLoading, IntroductionUnavailable } from "@/components/introductions/IntroductionStates";
import { useExplanationViewed, useIntroduction } from "@/components/introductions/useIntroduction";

const SECTIONS = ["friction", "unknown"];

/** I03 Friction & uncertainty: one plausible friction, one explicit unknown, and a way to correct us. Neutral framing. */
export default function ConsiderationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useRequireMember();
  const q = useIntroduction(me ? id : "");
  const intro = q.data;
  const ex = intro?.explanation ?? null;
  useExplanationViewed(id, SECTIONS, !!ex);

  return (
    <AppShell>
      {q.isLoading && <IntroductionLoading />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {intro && !intro.profile && <IntroductionUnavailable passed={intro.status === "you_passed"} />}
      {intro && intro.profile && (
        <>
          <IntroductionHeader intro={intro} active="considerations" />
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">Balanced information, not a verdict. Differences are just differences; nothing here is a defect, and we never infer protected characteristics or diagnoses.</p>
            {ex ? (
              <>
                <Card as="section" aria-labelledby="friction">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id="friction" className="text-lg font-bold text-ink">
                      One thing you might need to work through
                    </h2>
                    <EvidenceLabel strength={ex.friction.strength} />
                  </div>
                  <p className="mt-2 text-ink">{ex.friction.text}</p>
                </Card>
                <Card as="section" aria-labelledby="unknown">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id="unknown" className="text-lg font-bold text-ink">
                      What only a real date can tell you
                    </h2>
                    <EvidenceLabel strength={ex.unknown.strength} />
                  </div>
                  <p className="mt-2 text-ink">{ex.unknown.text}</p>
                  {ex.unknown.missing_signal_keys && ex.unknown.missing_signal_keys.length > 0 && <p className="mt-2 text-xs text-ink-tertiary">We have little or no signal for: {ex.unknown.missing_signal_keys.map((k) => k.split(".").pop()?.replace(/_/g, " ")).join(", ")}. You can fill these in below.</p>}
                </Card>
              </>
            ) : (
              <Card>
                <p className="text-ink-secondary">The friction and unknown are part of the explanation still under concierge review.</p>
              </Card>
            )}
            {intro.status === "offered" && (
              <LinkButton href={`/introductions/${intro.id}/decision`} fullWidth>
                Decide with this in mind
              </LinkButton>
            )}
            {intro.actions.can_correct && <CorrectionForm introId={intro.id} suggestedKeys={ex?.unknown.missing_signal_keys ?? []} title="Did we get something wrong about you?" />}
          </div>
        </>
      )}
    </AppShell>
  );
}
