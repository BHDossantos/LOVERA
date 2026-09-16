"use client";

import { use } from "react";
import { ApiError } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Card, ErrorState, EvidenceLabel, LinkButton, StatusBanner } from "@/components/ui";
import { IntroductionHeader } from "@/components/introductions/IntroductionHeader";
import { IntroductionLoading, IntroductionUnavailable } from "@/components/introductions/IntroductionStates";
import { ProfileCard } from "@/components/introductions/ProfileCard";
import { useExplanationViewed, useIntroduction } from "@/components/introductions/useIntroduction";

const THESIS_SECTIONS = ["thesis"];

/** I01 Curated introduction: one complete card and a compact compatibility thesis. Primary action: open the evidence. */
export default function IntroductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useRequireMember();
  const q = useIntroduction(me ? id : "");
  const intro = q.data;
  useExplanationViewed(id, THESIS_SECTIONS, !!intro?.explanation);

  return (
    <AppShell>
      {q.isLoading && <IntroductionLoading />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {intro && !intro.profile && <IntroductionUnavailable passed={intro.status === "you_passed"} />}
      {intro && intro.profile && (
        <>
          <IntroductionHeader intro={intro} active="card" showExtend />
          {intro.status === "awaiting_other_member" && <StatusBanner type="success" title="Your yes is private until they decide" body="If they also say yes, a conversation opens. If not, nothing about your choice is ever shared." />}
          {intro.status === "mutual" && (
            <StatusBanner type="success" title="You both said yes" action={<LinkButton href={`/introductions/${intro.id}/mutual`}>See your next steps</LinkButton>} />
          )}
          <div className="space-y-4">
            <ProfileCard profile={intro.profile} />
            {intro.explanation ? (
              <Card as="section" aria-labelledby="thesis">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="thesis" className="text-lg font-bold text-ink">
                    Why the matchmaker chose this
                  </h2>
                  {intro.explanation.reasons[0] && <EvidenceLabel strength={intro.explanation.reasons[0].strength} />}
                </div>
                {intro.explanation.reasons[0] ? (
                  <p className="mt-2 text-ink">
                    <span className="font-semibold">{intro.explanation.reasons[0].label}.</span> {intro.explanation.reasons[0].text}
                  </p>
                ) : (
                  <p className="mt-2 text-ink-secondary">The full reasoning is on the next screen.</p>
                )}
                <p className="mt-2 text-sm text-ink-secondary">Three reasons, one honest friction and what only a real date can tell you are one tap away. No percentages, no scores.</p>
                <LinkButton href={`/introductions/${intro.id}/why`} fullWidth className="mt-4">
                  Open the evidence
                </LinkButton>
              </Card>
            ) : (
              <Card as="section">
                <h2 className="text-lg font-bold text-ink">The explanation is being prepared</h2>
                <p className="mt-1 text-sm text-ink-secondary">A concierge reviews every explanation before it is shown. Check back shortly; the review window is unaffected.</p>
              </Card>
            )}
            {intro.status === "offered" && (
              <Card as="section" aria-labelledby="decide" className="p-4">
                <h2 id="decide" className="font-semibold text-ink">
                  Ready to decide?
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">{intro.privacy}</p>
                <LinkButton href={`/introductions/${intro.id}/decision`} variant="secondary" fullWidth className="mt-3">
                  Give my private decision
                </LinkButton>
              </Card>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
