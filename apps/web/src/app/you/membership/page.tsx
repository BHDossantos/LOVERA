"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, newIdempotencyKey, post } from "@/lib/api";
import { useAuth, useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, KeyValue, Modal, PageTitle, Select, Skeleton, StatusBanner, cx } from "@/components/ui";
import { euro, formatDate } from "@/lib/format";
import type { Capabilities } from "@/lib/types";

type Plan = { id: string; name: string; price_cents: number; currency: string; cadence: string; weekly_intro_cap: number; included: string[]; not_included: string[] };
type PlansOut = { plans: Plan[]; renewal_terms: string; principles: string[] };
type Ledger = { id: string; amount: number; reason: string; balance_after: number; created_at: string; expires_at: string | null };
type Current = { entitlements: Capabilities["entitlements"]; ledger: Ledger[] };
type Checkout = { hosted_url: string; checkout_id: string };

const CANCEL_REASONS = [
  ["met_someone", "I met someone"],
  ["taking_a_break", "Taking a break from dating"],
  ["not_enough_introductions", "Not enough introductions"],
  ["too_expensive", "Too expensive right now"],
  ["other", "Something else"],
];

/** Y06 Membership & credits: single transparent price, included / not included, protected credits, renewal, cancel in-app. */
export default function MembershipPage() {
  const { me } = useRequireMember();
  const { refresh } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => get<PlansOut>("/plans"), enabled: !!me });
  const current = useQuery({ queryKey: ["subscription"], queryFn: () => get<Current>("/subscriptions/current"), enabled: !!me });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("taking_a_break");

  const checkout = async (plan: string) => {
    setBusy(plan);
    setError(null);
    try {
      const c = await post<Checkout>("/subscriptions/checkout", { plan }, { idempotencyKey: newIdempotencyKey() });
      router.push(c.hosted_url);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      await post("/subscriptions/cancel", { reason });
      await qc.invalidateQueries({ queryKey: ["subscription"] });
      await refresh();
      setCancelOpen(false);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const ent = current.data?.entitlements;
  const pro = plans.data?.plans.find((p) => p.id === "pro");
  const activePlan = plans.data?.plans.find((p) => p.id === ent?.plan);
  return (
    <AppShell>
      <PageTitle eyebrow="You · Membership" title="Membership and credits" lede="One price, stated plainly. We charge for the work of matching and coordination, never for trust, safety, privacy or control." />
      {(plans.isLoading || current.isLoading) && <Skeleton lines={6} label="Loading membership" />}
      {plans.error && <ErrorState error={plans.error as ApiError} retry={() => plans.refetch()} />}
      {current.error && <ErrorState error={current.error as ApiError} retry={() => current.refetch()} />}
      <ErrorState error={error} />
      {ent && plans.data && (
        <>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Your plan: {ent.plan_name}</h2>
            <KeyValue
              items={[
                { k: "Status", v: ent.paid ? (ent.cancel_at_period_end ? "Cancelled · access continues" : ent.status === "past_due" ? "Payment failed · please retry" : "Active") : "Free" },
                { k: "Price", v: activePlan ? `${euro(activePlan.price_cents)} / month` : "—" },
                { k: ent.cancel_at_period_end ? "Access ends" : "Renews", v: ent.renews_at ? formatDate(ent.renews_at) : "—" },
                { k: "Introductions per week", v: `up to ${ent.weekly_intro_cap}, when inventory supports it` },
                { k: "Protected credits", v: `${ent.protected_credits}` },
                { k: "Trial introductions left", v: ent.paid ? "—" : `${ent.trial_introductions_remaining}` },
              ]}
            />
            {ent.status === "past_due" && <StatusBanner type="caution" title="Your last payment didn't go through" body="Nothing is lost. Retry from the checkout to keep your plan." action={pro && <Button size="sm" loading={busy === "pro"} onClick={() => checkout("pro")}>Retry payment</Button>} />}
          </Card>
          {!ent.paid && pro && (
            <Card className="mb-4 border-action">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold">{pro.name}</h2>
                <p className="text-2xl font-bold text-ink">
                  {euro(pro.price_cents)} <span className="text-sm font-normal text-ink-secondary">/ month</span>
                </p>
              </div>
              <StatusBanner type="info" title="Before you pay: inventory is real, not infinite" body="Introductions depend on qualified, verified members in your city. If we can't introduce you in a paid week, you receive a protected credit that extends your membership." />
              <PlanLists plan={pro} />
              <Button fullWidth loading={busy === "pro"} onClick={() => checkout("pro")}>
                Start {pro.name} at {euro(pro.price_cents)} / month
              </Button>
              <p className="mt-2 text-xs text-ink-tertiary">{plans.data.renewal_terms}</p>
            </Card>
          )}
          {ent.paid && activePlan && (
            <Card className="mb-4">
              <h2 className="mb-2 font-bold">What your plan includes</h2>
              <PlanLists plan={activePlan} />
              <p className="text-xs text-ink-tertiary">{plans.data.renewal_terms}</p>
            </Card>
          )}
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Protected credits</h2>
            <p className="mb-2 text-sm text-ink-secondary">A credit is added whenever a paid week passes without a qualified introduction. Credits extend your membership; they are never a reason to lower your Must criteria.</p>
            {current.data && current.data.ledger.length === 0 && <p className="text-sm text-ink-tertiary">No credit movements yet.</p>}
            <ul className="divide-y divide-border">
              {current.data?.ledger.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 py-2 text-sm">
                  <span className="text-ink">
                    {l.amount > 0 ? "+" : ""}
                    {l.amount} · {l.reason.replace(/_/g, " ")}
                  </span>
                  <span className="text-ink-secondary">
                    {formatDate(l.created_at)} · balance {l.balance_after}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Principles</h2>
            <ul className="list-disc pl-5 text-sm text-ink-secondary">
              {plans.data.principles.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Card>
          {ent.paid && !ent.cancel_at_period_end && (
            <Button variant="danger" fullWidth onClick={() => setCancelOpen(true)}>
              Cancel my membership
            </Button>
          )}
          <Modal open={cancelOpen} title="Cancel membership?" onClose={() => setCancelOpen(false)}>
            <p className="mb-3 text-sm text-ink-secondary">
              Your access continues until {ent.renews_at ? formatDate(ent.renews_at) : "the end of the paid period"}. After that you keep your profile, conversations, safety tools and one trial introduction on the free plan. No support contact needed; you can rejoin any time.
            </p>
            <label htmlFor="creason" className="mb-1 block text-sm font-semibold">
              Why (optional, helps us improve)
            </label>
            <Select id="creason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {CANCEL_REASONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button variant="danger" loading={busy === "cancel"} onClick={cancel}>
                Cancel at the end of the period
              </Button>
              <Button variant="secondary" onClick={() => setCancelOpen(false)}>
                Keep my membership
              </Button>
            </div>
          </Modal>
        </>
      )}
    </AppShell>
  );
}

function PlanLists({ plan }: { plan: Plan }) {
  return (
    <div className={cx("mb-4 grid gap-4", plan.not_included.length ? "sm:grid-cols-2" : "")}>
      <div>
        <h3 className="mb-1 text-sm font-semibold">Included</h3>
        <ul className="space-y-1 text-sm text-ink">
          {plan.included.map((i) => (
            <li key={i}>
              <span aria-hidden>✓ </span>
              {i}
            </li>
          ))}
        </ul>
      </div>
      {plan.not_included.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Not included</h3>
          <ul className="space-y-1 text-sm text-ink-secondary">
            {plan.not_included.map((i) => (
              <li key={i}>
                <span aria-hidden>— </span>
                {i}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
