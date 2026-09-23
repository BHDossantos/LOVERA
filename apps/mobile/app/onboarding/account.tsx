import { useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, post } from "@/api/client";
import type { Me } from "@/api/types";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { Button, Card, ErrorState, Field, PageTitle, Screen, Steps, TextInput, Toggle } from "@/components/ui";

/**
 * O02 Adult consent. The 18+ gate and the consent ledger.
 *
 * The three agreements are separate switches, not one "I agree to everything": the
 * consent record is versioned per document, and App Review checks that a dating app
 * gates on age before showing anyone a profile.
 */
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

  const ready = /^\d{4}-\d{2}-\d{2}$/.test(birth) && terms && privacy && community;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post<Me>("/me/adult-consent", {
        birth_date: birth,
        accept_terms: terms,
        accept_privacy: privacy,
        accept_community: community,
        ai_processing_consent: ai,
        special_category_consent: special,
      });
      const m = await refresh();
      if (m) router.replace(nextOnboardingPath(m) as never);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Steps step={1} />
      <PageTitle
        eyebrow="Your account"
        title="A few things to agree on"
        lede="Everyone here is a verified adult. These are separate agreements, and you can withdraw the optional ones later."
      />
      <ErrorState error={error} />
      <Card>
        <Field
          label="Date of birth"
          help="Private. Used for the 18+ gate and to show your age to introductions. Verified later against your ID."
        >
          <TextInput
            value={birth}
            onChangeText={setBirth}
            placeholder="YYYY-MM-DD"
            inputMode="numeric"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            autoCorrect={false}
            accessibilityLabel="Date of birth, year month day"
          />
        </Field>
        <Toggle
          value={terms}
          onValueChange={setTerms}
          label="I accept the Terms of Service (v2026-09)"
          description="Monthly plans renew until cancelled; cancellation is in the app."
        />
        <Toggle
          value={privacy}
          onValueChange={setPrivacy}
          label="I have read the Privacy Notice (v2026-09)"
          description="Identity documents are checked by our vendor and never stored by us. Exact location is never collected."
        />
        <Toggle
          value={community}
          onValueChange={setCommunity}
          label="I agree to the Community Agreement"
          description="Respectful contact, public first dates, no money requests, no recording without consent."
        />
      </Card>
      <Card>
        <Toggle
          value={ai}
          onValueChange={setAi}
          label="AI may help structure my interview answers"
          description="An AI turns your words into signals you confirm. It never sends messages or rates you. Separate from the terms; you can revoke it."
        />
        <Toggle
          value={special}
          onValueChange={setSpecial}
          label="I may choose to share faith for matching"
          description="Optional sensitive data. Off means the faith question is skipped and never used."
        />
      </Card>
      <Button onPress={submit} loading={busy} disabled={!ready}>
        Create my account
      </Button>
    </Screen>
  );
}
