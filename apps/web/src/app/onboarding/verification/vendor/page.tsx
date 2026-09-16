"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { Button, Card, ChoiceCard, ErrorState, PageTitle } from "@/components/ui";

/** Sandbox stand-in for the vendor-hosted capture page. In production the vendor hosts this and posts a signed webhook. */
function VendorInner() {
  useRequireMember({ allowOnboarding: true });
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const ref = params.get("ref") ?? "";
  const [outcome, setOutcome] = useState<"verified" | "failed" | "review">("verified");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const complete = async () => {
    setBusy(true);
    try {
      await post("/verification/sandbox/complete", { provider_ref: ref, outcome, age_over_18: outcome !== "failed", liveness_passed: outcome !== "failed", reason_code: outcome === "failed" ? "no_match" : null });
      await qc.invalidateQueries({ queryKey: ["verification"] });
      router.replace("/onboarding/verification");
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-dvh bg-ink text-white">
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="mb-2 text-sm uppercase tracking-wide text-white/60">Vendor sandbox · not our servers</p>
        <PageTitle title="Identity check" />
        <Card className="text-ink">
          <p className="mb-4 text-sm text-ink-secondary">This page simulates the identity vendor's hosted capture flow (document scan + liveness selfie). Choose an outcome; the vendor then delivers a signed webhook to the platform.</p>
          <div role="radiogroup" aria-label="Simulated outcome" className="space-y-2">
            <ChoiceCard title="Passed: adult, document matches selfie" selected={outcome === "verified"} onSelect={() => setOutcome("verified")} />
            <ChoiceCard title="Needs review: uncertain match" selected={outcome === "review"} onSelect={() => setOutcome("review")} />
            <ChoiceCard title="Failed: no match" selected={outcome === "failed"} onSelect={() => setOutcome("failed")} />
          </div>
          <ErrorState error={error} />
          <Button fullWidth className="mt-4" loading={busy} onClick={complete}>
            Finish capture
          </Button>
        </Card>
      </main>
    </div>
  );
}

export default function VendorPage() {
  return (
    <Suspense>
      <VendorInner />
    </Suspense>
  );
}
