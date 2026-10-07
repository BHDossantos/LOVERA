import { useRouter } from "expo-router";
import { useRequireMember } from "@/lib/auth";
import { ProfileEditor } from "@/components/ProfileEditor";
import { Button, PageTitle, Screen } from "@/components/ui";

/**
 * Y03 Profile, after onboarding.
 *
 * The editor is the same component onboarding uses, which is the point: a member who has
 * been here six months edits their profile with exactly the controls they first met, and
 * there is one implementation to keep honest. Until now it existed only in onboarding, so
 * an active member could not change a photo, a prompt or their bio at all.
 */
export default function YouProfile() {
  useRequireMember();
  const router = useRouter();
  return (
    <Screen>
      <PageTitle
        eyebrow="You · Profile"
        title="Your profile"
        lede="What an introduction shows about you. Changes to photos go through moderation before anyone sees them."
      />
      <ProfileEditor />
      <Button variant="ghost" onPress={() => router.back()}>
        Done
      </Button>
    </Screen>
  );
}
