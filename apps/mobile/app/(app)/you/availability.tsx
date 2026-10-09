import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, useRequireMember } from "@/lib/auth";
import { AvailabilityEditor } from "@/components/AvailabilityEditor";
import { PageTitle, Screen } from "@/components/ui";

/**
 * Y04 Availability and readiness, after onboarding.
 *
 * `date_ready` lives on `PUT /availability`, and the editor that sets it existed only inside
 * onboarding — so a member who turned readiness off could never turn it back on, while Today
 * kept emitting a task telling them to. The badge on the You tab showed the state and offered
 * nothing to do about it.
 *
 * Same editor as onboarding, which is the point: one implementation to keep honest.
 */
export default function YouAvailability() {
  useRequireMember();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  return (
    <Screen>
      <PageTitle
        eyebrow="You · Availability"
        title="When you could meet, and whether you're open"
        lede="Introductions only happen between people who could actually meet within two weeks. Windows are coarse; we never see event titles or who you are with."
      />
      <AvailabilityEditor
        cta="Save my availability"
        onSaved={async () => {
          // The readiness badge on the You tab reads `me`, so it has to be refetched or it
          // keeps showing the value the member just changed away from.
          //
          // Today needs the same, and `refresh()` does not reach it: this screen is usually
          // opened *from* Today's readiness task, so `router.back()` returns to a Today that was
          // never unmounted — `refetchOnMount` cannot fire — and it would go on offering the
          // task that has just been done until its next sixty-second poll.
          await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["today"] })]);
          router.back();
        }}
      />
    </Screen>
  );
}
