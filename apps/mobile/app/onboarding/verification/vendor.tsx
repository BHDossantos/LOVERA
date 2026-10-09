import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, post } from "@/api/client";
import { Button, Card, ChoiceCard, ErrorState, PageTitle, Screen } from "@/components/ui";

/**
 * The sandbox vendor, rendered natively. In production the provider hosts this step and
 * the member never sees this screen; it exists so the whole journey can be exercised
 * end to end without a live vendor contract — including by an App Review tester.
 */
export default function VendorSandbox() {
  const router = useRouter();
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const [outcome, setOutcome] = useState("verified");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/verification/sandbox/complete", {
        provider_ref: ref,
        outcome,
        age_over_18: outcome !== "failed",
        liveness_passed: outcome !== "failed",
        reason_code: outcome === "failed" ? "no_match" : null,
      });
      router.replace("/onboarding/verification");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle
        eyebrow="Verification partner (sandbox)"
        title="Finish capture"
        lede="This stands in for the vendor's hosted document and liveness capture."
      />
      <ErrorState error={error} />
      <Card>
        <ChoiceCard title="Verified" body="Document and liveness both pass." selected={outcome === "verified"} onSelect={() => setOutcome("verified")} />
        <ChoiceCard title="Needs human review" body="Inconclusive; a reviewer decides." selected={outcome === "review_required"} onSelect={() => setOutcome("review_required")} />
        <ChoiceCard title="Failed" body="No match between document and selfie." selected={outcome === "failed"} onSelect={() => setOutcome("failed")} />
      </Card>
      <Button onPress={complete} loading={busy}>
        Finish capture
      </Button>
    </Screen>
  );
}
