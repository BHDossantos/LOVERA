"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useAuth, useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, KeyValue, LinkButton, PageTitle, Skeleton, StatusBanner } from "@/components/ui";
import { euro } from "@/lib/format";

type Checkout = {
  checkout_id: string;
  plan: string;
  plan_name: string;
  cadence: string;
  price_cents: number;
  period_days: number;
  currency: string;
  status: string;
  renewal_terms: string;
  inventory_notice: string;
};

/** Sandbox stand-in for the hosted payment page. In production the provider hosts this; the app only receives a signed webhook. */
function CheckoutInner() {
  const { me } = useRequireMember();
  const { refresh } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";
  // What this checkout is actually for. This page used to look up "pro" in the plan list and
  // render its monthly price whatever had been started, so somebody buying Concierge annually
  // was shown "Matchmaker Pro, EUR 39 / month" on the screen where they confirm the charge.
  const checkout = useQuery({
    queryKey: ["checkout", ref],
    queryFn: () => get<Checkout>(`/subscriptions/checkout/${ref}`),
    enabled: !!me && !!ref,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [failed, setFailed] = useState(false);
  const c = checkout.data;
  const annual = c?.cadence === "annual";

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
      {checkout.isLoading && <Skeleton lines={4} label="Loading plan" />}
      {checkout.error && <ErrorState error={checkout.error as ApiError} retry={() => checkout.refetch()} />}
      <ErrorState error={error} />
      {failed && <StatusBanner type="caution" title="Payment failed (simulated)" body="Nothing was charged. Your account stays as it was; you can try again." action={<Button size="sm" loading={busy === "paid"} onClick={() => pay("paid")}>Try again</Button>} />}
      {ref && c && (
        <Card className="mb-4">
          <KeyValue
            items={[
              { k: "Plan", v: c.plan_name },
              { k: "Billed", v: annual ? "Once a year" : "Every month" },
              { k: "Price", v: `${euro(c.price_cents)} / ${annual ? "year" : "month"}` },
              ...(annual ? [{ k: "Works out at", v: `${euro(Math.round(c.price_cents / 12))} a month` }] : []),
              { k: "Renewal", v: `${annual ? "Annually" : "Monthly"} until you cancel in the app` },
              { k: "Reference", v: ref },
            ]}
          />
          <p className="mt-3 text-sm text-ink-secondary">{c.renewal_terms}</p>
          <StatusBanner type="info" title="Inventory notice" body={c.inventory_notice} />
          <Button fullWidth loading={busy === "paid"} onClick={() => pay("paid")}>
            Pay {euro(c.price_cents)} and start {c.plan_name}
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
