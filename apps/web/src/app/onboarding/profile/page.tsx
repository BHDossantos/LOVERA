"use client";

import { useRouter } from "next/navigation";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { OnboardingShell } from "@/components/shell/AppShell";
import { Button, PageTitle } from "@/components/ui";
import { ProfileEditor } from "@/components/profile/ProfileEditor";

/** O07 Profile builder: photos, voice, prompts, languages, preview. AI never rewrites identity claims. */
export default function ProfileOnboarding() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  return (
    <OnboardingShell step={6}>
      <PageTitle eyebrow="Profile" title="Show up as yourself" lede="A truthful, multidimensional profile: a few photos, prompts in your voice, the languages you speak. No beauty-score optimizer here." />
      <ProfileEditor
        onSaved={async () => {
          const m = await refresh();
          if (m && m.onboarding_step !== "profile") router.replace(nextOnboardingPath(m));
        }}
      />
      <Button
        variant="secondary"
        fullWidth
        className="mt-4"
        onClick={async () => {
          const m = await refresh();
          if (m) router.replace(nextOnboardingPath(m));
        }}
      >
        Continue to availability
      </Button>
    </OnboardingShell>
  );
}
