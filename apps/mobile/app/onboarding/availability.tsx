import { useRouter } from "expo-router";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { AvailabilityEditor } from "@/components/AvailabilityEditor";
import { PageTitle, Screen, Steps } from "@/components/ui";

/** O08 Availability & readiness: recurring windows, date style, readiness toggle. */
export default function AvailabilityOnboarding() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  return (
    <Screen>
      <Steps step={7} />
      <PageTitle
        eyebrow="Availability"
        title="When could you realistically meet?"
        lede="Introductions only happen between people who can meet within two weeks. We use coarse windows; event titles and attendees are never seen."
      />
      <AvailabilityEditor
        cta="Declare my availability"
        onSaved={async () => {
          const m = await refresh();
          if (m) router.replace(nextOnboardingPath(m) as never);
        }}
      />
    </Screen>
  );
}
