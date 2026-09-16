"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useAuth, useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, KeyValue, LinkButton, PageTitle, Skeleton, StatusBanner } from "@/components/ui";
import { euro } from "@/lib/format";

type Plan = { id: string; name: string; price_cents: number };
type PlansOut = { plans: Plan[]; renewal_terms: string };

/** Sandbox stand-in for the hosted payment page. In production the provider hosts this; the app only receives a signed webhook. */
function CheckoutInner() {
  const { me } = useRequireMember();
  const { refresh } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => get<PlansOut>("/plans"), enabled: !!me });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [failed, setFailed] = useState(false);
  const pro = plans.data?.plans.find((p) => p.id === "pro");

  const pay = async (outcome: "paid" | "failed") => {
    setBusy(outcome);
    setError(null);
    try {
      await post("/subscriptions/sandbox/pay", { checkout_ref: ref, outcome });
      await qc.invalidateQueries({ queryKey: ["subscription"] });
      await refresh();
      if (outcome === "paid") router.replace("/you/membership");
      else setFailed(true);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell>
      <PageTitle eyebrow="Sandbox checkout" title="Confirm your membership" lede="This page stands in for the payment provider's hosted checkout. No card details are collected here." />
      {!ref && <StatusBanner type="error" title="Missing checkout reference" body="Start again from the membership page." action={<LinkButton href="/you/membership" variant="secondary">Back to membership</LinkButton>} />}
      {plans.isLoading && <Skeleton lines={4} label="Loading plan" />}
      <ErrorState error={error} />
      {failed && <StatusBanner type="caution" title="Payment failed (simulated)" body="Nothing was charged. Your account stays as it was; you can try again." action={<Button size="sm" loading={busy === "paid"} onClick={() => pay("paid")}>Try again</Button>} />}
      {ref && pro && (
        <Card className="mb-4">
          <KeyValue
            items={[
              { k: "Plan", v: pro.name },
              { k: "Price", v: `${euro(pro.price_cents)} / month` },
              { k: "Renewal", v: "Monthly until you cancel in the app" },
              { k: "Reference", v: ref },
            ]}
          />
          <p className="mt-3 text-sm text-ink-secondary">{plans.data?.renewal_terms}</p>
          <StatusBanner type="info" title="Inventory notice" body="Introductions depend on qualified, verified members in your city. A paid week without one earns a protected credit." />
          <Button fullWidth loading={busy === "paid"} onClick={() => pay("paid")}>
            Pay {euro(pro.price_cents)} and start {pro.name}
          </Button>
          <Button variant="ghost" fullWidth className="mt-2" loading={busy === "failed"} onClick={() => pay("failed")}>
            Simulate a failed payment
          </Button>
          <LinkButton href="/you/membership" variant="ghost" fullWidth className="mt-2">
            Go back without paying
          </LinkButton>
        </Card>
      )}
    </AppShell>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense>
      <CheckoutInner />
    </Suspense>
  );
}
