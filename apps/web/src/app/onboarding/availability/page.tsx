"use client";

import { useRouter } from "next/navigation";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { OnboardingShell } from "@/components/shell/AppShell";
import { PageTitle } from "@/components/ui";
import { AvailabilityEditor } from "@/components/profile/AvailabilityEditor";

/** O08 Availability & readiness: recurring windows, date style, readiness toggle. Coarse free/busy only. */
export default function AvailabilityOnboarding() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  return (
    <OnboardingShell step={7}>
      <PageTitle eyebrow="Availability" title="When could you realistically meet?" lede="Introductions only happen between people who can meet within two weeks. We use coarse windows; event titles and attendees are never seen." />
      <AvailabilityEditor
        onSaved={async () => {
          const m = await refresh();
          if (m) router.replace(nextOnboardingPath(m));
        }}
        cta="Declare my availability"
      />
    </OnboardingShell>
  );
}
