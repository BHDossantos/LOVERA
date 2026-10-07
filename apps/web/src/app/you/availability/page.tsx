"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, useRequireMember } from "@/lib/auth";
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
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  return (
    <AppShell>
      <PageTitle
        eyebrow="You · Availability"
        title="When you could meet, and whether you're open"
        lede="Introductions only happen between people who could actually meet within two weeks. Windows are coarse; we never see event titles or who you are with."
      />
      {/* Today has its own query and a fifteen-second freshness window, so a member who came
          here from its readiness task and goes back within that window sees the task they have
          just done, still asking. The editor only updates `availability`. */}
      <AvailabilityEditor
        cta="Save my availability"
        onSaved={async () => {
          // `me` is context state behind `refresh()`, not a query, so the readiness badge on the
          // You hub needs that call rather than an invalidation.
          await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["today"] })]);
          router.push("/you");
        }}
      />
    </AppShell>
  );
}
