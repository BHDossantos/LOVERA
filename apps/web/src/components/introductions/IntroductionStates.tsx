"use client";

import Link from "next/link";
import { Card, LinkButton, Skeleton } from "@/components/ui";

/** Neutral card for "unavailable" (expiry, withdrawal or the other member's private decision are indistinguishable). */
export function IntroductionUnavailable({ passed }: { passed?: boolean }) {
  return (
    <Card>
      <h1 className="text-xl font-bold text-ink">{passed ? "You passed on this introduction" : "This introduction is no longer available"}</h1>
      <p className="mt-2 text-ink-secondary">{passed ? "Your decision stays private and never affects your visibility. Nothing about it was shared." : "The review window closed or the introduction was withdrawn. Nothing about your choice was shared with anyone, and this does not change your standing."}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton href="/introductions" variant="secondary">
          Back to introductions
        </LinkButton>
        <Link href="/today" className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-action">
          What's next today
        </Link>
      </div>
    </Card>
  );
}

export function IntroductionLoading() {
  return (
    <div className="space-y-4">
      <Skeleton lines={2} label="Loading introduction" />
      <div aria-hidden className="skeleton aspect-[4/5] w-full" />
      <Skeleton lines={4} />
    </div>
  );
}
