"use client";

import { useRouter } from "next/navigation";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { PageTitle } from "@/components/ui";
import { AvailabilityEditor } from "@/components/profile/AvailabilityEditor";

/**
 * Y04 Availability and readiness, after onboarding.
 *
 * `date_ready` is set through `PUT /availability`, and this editor existed only inside
 * onboarding — so a member who turned readiness off had no way to turn it back on, while
 * Today's readiness task pointed at /you/profile, which cannot change it.
 */
export default function AvailabilityPage() {
  useRequireMember();
  const router = useRouter();
  return (
    <AppShell>
      <PageTitle
        eyebrow="You · Availability"
        title="When you could meet, and whether you're open"
        lede="Introductions only happen between people who could actually meet within two weeks. Windows are coarse; we never see event titles or who you are with."
      />
      <AvailabilityEditor cta="Save my availability" onSaved={() => router.push("/you")} />
    </AppShell>
  );
}
