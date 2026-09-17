"use client";

import Link from "next/link";
import { use } from "react";
import { ApiError } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Card, ErrorState, LinkButton, StatusBanner, VerificationBadge } from "@/components/ui";
import { IntroductionLoading, IntroductionUnavailable } from "@/components/introductions/IntroductionStates";
import { ProfileCard } from "@/components/introductions/ProfileCard";
import { useIntroduction } from "@/components/introductions/useIntroduction";

/** I05 Mutual acceptance: calm celebration, the reciprocity rule, and two next steps. Openers are drafts, never sent for you. */
export default function MutualPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useRequireMember();
  const q = useIntroduction(me ? id : "");
  const intro = q.data;

  return (
    <AppShell>
      {q.isLoading && <IntroductionLoading />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {intro && !intro.profile && <IntroductionUnavailable passed={intro.status === "you_passed"} />}
      {intro && intro.profile && intro.status !== "mutual" && (
        <>
          <StatusBanner type="info" title="Not mutual yet" body="This page opens once you have both said yes. Nothing about anyone's one-sided decision is shown." />
          <LinkButton href={`/introductions/${intro.id}`} variant="secondary">
            Back to the introduction
          </LinkButton>
        </>
      )}
      {intro && intro.profile && intro.status === "mutual" && (
        <div className="space-y-4">
          <header>
            <Link href="/introductions" className="inline-flex min-h-11 items-center text-sm font-semibold text-action">
              ← All introductions
            </Link>
            <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-context">Mutual</p>
            <h1 className="text-2xl font-bold leading-tight text-ink sm:text-3xl">You and {intro.profile.display_name} both said yes</h1>
            <p className="mt-2 text-ink-secondary">
              <VerificationBadge verified={intro.profile.verified} small /> Chat is open because each of you privately chose it. Neither of you saw the other's answer first, and there is no rush.
            </p>
          </header>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card as="section" className="flex flex-col">
              <h2 className="font-semibold text-ink">Start the conversation</h2>
              <p className="mt-1 flex-1 text-sm text-ink-secondary">Say hello in your own words. If you'd like a hand, the AI Wingman offers editable drafts; nothing is sent until you press send.</p>
              {intro.conversation_id && (
                <LinkButton href={`/messages/${intro.conversation_id}`} fullWidth className="mt-3">
                  Start the conversation
                </LinkButton>
              )}
            </Card>
            <Card as="section" className="flex flex-col">
              <h2 className="font-semibold text-ink">Plan a date</h2>
              <p className="mt-1 flex-1 text-sm text-ink-secondary">Skip the small talk if you both prefer: pick a public place and an overlapping time.</p>
              {intro.conversation_id && (
                <LinkButton href={`/dates/new?conversation=${intro.conversation_id}`} variant="secondary" fullWidth className="mt-3">
                  Plan a date
                </LinkButton>
              )}
            </Card>
          </div>
          {!intro.conversation_id && <StatusBanner type="caution" title="The conversation is being opened" body="Refresh in a moment if the buttons above haven't appeared yet." action={<LinkButton href="/messages" variant="secondary">Go to Messages</LinkButton>} />}
          <ProfileCard profile={intro.profile} compact />
          <p className="text-xs text-ink-tertiary">Safety tools, including report and block, are available inside the conversation at any time.</p>
        </div>
      )}
    </AppShell>
  );
}
