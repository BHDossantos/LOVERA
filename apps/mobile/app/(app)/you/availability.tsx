import { useRouter } from "expo-router";
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
          await refresh();
          router.back();
        }}
      />
    </Screen>
  );
}
