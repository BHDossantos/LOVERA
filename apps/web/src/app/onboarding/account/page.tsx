"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, post } from "@/lib/api";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { OnboardingShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, Field, PageTitle, TextInput, Toggle } from "@/components/ui";
import type { Me } from "@/lib/types";

/** O02 Account & adult consent: 18+ gate, versioned terms, separate AI and special-category consent. */
export default function AccountConsent() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  const [birth, setBirth] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [community, setCommunity] = useState(false);
  const [ai, setAi] = useState(true);
  const [special, setSpecial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post<Me>("/me/adult-consent", { birth_date: birth, accept_terms: terms, accept_privacy: privacy, accept_community: community, ai_processing_consent: ai, special_category_consent: special });
      const m = await refresh();
      if (m) router.replace(nextOnboardingPath(m));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingShell step={1}>
      <PageTitle eyebrow="Account" title="Confirm you're an adult and how we may use your data" lede="This service is for adults seeking a serious relationship. Each consent is recorded with its version and can be changed later in Privacy." />
      <ErrorState error={error} />
      <form onSubmit={submit}>
        <Card className="mb-4">
          <Field label="Date of birth" htmlFor="birth" help="Private. Used for the 18+ gate and to show your age to introductions. Verified later against your ID.">
            <TextInput id="birth" type="date" required value={birth} onChange={(e) => setBirth(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
          </Field>
        </Card>
        <Card className="mb-4 divide-y divide-border">
          <Toggle checked={terms} onChange={setTerms} label="I accept the Terms of Service (v2026-09)" description="Monthly plans renew until cancelled; cancellation is in the app." />
          <Toggle checked={privacy} onChange={setPrivacy} label="I have read the Privacy Notice (v2026-09)" description="Identity documents are checked by our vendor and never stored by us. Exact location is never collected." />
          <Toggle checked={community} onChange={setCommunity} label="I agree to the Community Agreement" description="Respectful contact, public first dates, no money requests, no recording without consent." />
        </Card>
        <Card className="mb-6 divide-y divide-border">
          <Toggle checked={ai} onChange={setAi} label="AI may help structure my interview answers" description="An AI turns your words into signals you confirm. It never sends messages or rates you. Separate from the terms; you can revoke it." />
          <Toggle checked={special} onChange={setSpecial} label="I may choose to share faith for matching" description="Optional sensitive data. Off means the faith question is skipped and never used." />
        </Card>
        <Button type="submit" fullWidth loading={busy} disabled={!terms || !privacy || !community || !birth}>
          Create my account
        </Button>
      </form>
    </OnboardingShell>
  );
}
