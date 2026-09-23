import { useRouter } from "expo-router";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { ProfileEditor } from "@/components/ProfileEditor";
import { Button, PageTitle, Screen, Steps } from "@/components/ui";

/** O07 Profile builder: photos, prompts, languages. AI never rewrites identity claims. */
export default function ProfileOnboarding() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  return (
    <Screen>
      <Steps step={6} />
      <PageTitle
        eyebrow="Profile"
        title="Show up as yourself"
        lede="A truthful, multidimensional profile: a few photos, prompts in your voice, the languages you speak. No beauty-score optimizer here."
      />
      <ProfileEditor
        onSaved={async () => {
          const m = await refresh();
          if (m && m.onboarding_step !== "profile") router.replace(nextOnboardingPath(m) as never);
        }}
      />
      <Button
        variant="secondary"
        onPress={async () => {
          const m = await refresh();
          if (m) router.replace(nextOnboardingPath(m) as never);
        }}
      >
        Continue to availability
      </Button>
    </Screen>
  );
}
