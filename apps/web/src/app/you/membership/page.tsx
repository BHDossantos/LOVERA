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

/**
 * Y06 Membership: the ladder, both terms, and what each rung actually buys.
 *
 * This page used to show one paid plan. Concierge existed in the catalog, cost more than twice
 * Pro, and was never offered here at all — which was the merciful half of the bug, because the
 * API granted it exactly what it granted Pro. The catalog now derives every bullet from the
 * features a plan really grants, so a comparison table built from `features` cannot flatter a
 * tier it does not deserve.
 *
 * The cadence toggle shows annual as a **price**, with the per-month equivalent beside it, rather
 * than as a percentage off a base nobody states. "Save 17%" is how subscription pricing hides the
 * number that matters.
 */
type Price = { cents: number; monthly_equivalent_cents: number; period_days: number };
type Plan = {
  id: string;
  name: string;
  tagline: string;
  currency: string;
  weekly_intro_cap: number;
  features: string[];
  included: string[];
  not_included: string[];
  prices: Record<string, Price>;
  annual_saving_cents: number;
  price_cents: number;
};
type PlansOut = { plans: Plan[]; cadences: string[]; renewal_terms: string; principles: string[] };
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

/** The comparison rows, in the order a member evaluating the ladder actually cares about. */
const COMPARE: { key: string; label: string }[] = [
  { key: "weekly_introductions", label: "Curated introductions every week" },
  { key: "adaptive_refresh", label: "Adaptive Blueprint refresh" },
  { key: "ai_wingman", label: "AI Wingman drafts" },
  { key: "translation", label: "In-conversation translation" },
  { key: "date_concierge", label: "Date concierge" },
  { key: "protected_credits", label: "Protected credits" },
  { key: "human_review", label: "Human matchmaker review" },
  { key: "priority_coordination", label: "Priority date coordination" },
];

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
  const [cadence, setCadence] = useState<string>("monthly");

  const checkout = async (plan: string) => {
    setBusy(plan);
    setError(null);
    try {
      const c = await post<Checkout>("/subscriptions/checkout", { plan, cadence }, { idempotencyKey: newIdempotencyKey() });
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
  const all = plans.data?.plans ?? [];
  const paidPlans = all.filter((p) => p.price_cents > 0);
  const activePlan = all.find((p) => p.id === ent?.plan);
  const annualSaving = paidPlans.find((p) => p.annual_saving_cents > 0)?.annual_saving_cents ?? 0;

  return (
    <AppShell>
      <PageTitle
        eyebrow="You · Membership"
        title="Membership and credits"
        lede="We charge for the work of matching and coordination, never for trust, safety, privacy or control. Every price on this page is the whole price."
      />
      {(plans.isLoading || current.isLoading) && <Skeleton lines={6} label="Loading membership" />}
      {plans.error && <ErrorState error={plans.error as ApiError} retry={() => plans.refetch()} />}
      {current.error && <ErrorState error={current.error as ApiError} retry={() => current.refetch()} />}
      <ErrorState error={error} />
      {ent && plans.data && (
        <>
          <Card className="mb-4">
            <h2 className="display mb-3 text-xl font-bold">Your plan: {ent.plan_name}</h2>
            <KeyValue
              items={[
                { k: "Status", v: ent.paid ? (ent.cancel_at_period_end ? "Cancelled · access continues" : ent.status === "past_due" ? "Payment failed · please retry" : "Active") : "Free" },
                // What this member agreed to pay, which is not necessarily today's catalog price.
                { k: "Price", v: ent.paid ? `${euro(ent.price_cents)} / ${ent.cadence === "annual" ? "year" : "month"}` : "Free" },
                { k: ent.cancel_at_period_end ? "Access ends" : "Renews", v: ent.renews_at ? formatDate(ent.renews_at) : "—" },
                { k: "Introductions per week", v: `up to ${ent.weekly_intro_cap}, when inventory supports it` },
                { k: "Protected credits", v: `${ent.protected_credits}` },
                { k: "Trial introductions left", v: ent.paid ? "—" : `${ent.trial_introductions_remaining}` },
              ]}
            />
            {ent.status === "past_due" && (
              <StatusBanner
                type="caution"
                title="Your last payment didn't go through"
                body="Nothing is lost. Retry from the checkout to keep your plan."
                action={activePlan && <Button size="sm" loading={busy === activePlan.id} onClick={() => checkout(activePlan.id)}>Retry payment</Button>}
              />
            )}
          </Card>

          {!ent.paid && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="display text-2xl font-bold">Choose a plan</h2>
                <CadenceToggle value={cadence} onChange={setCadence} cadences={plans.data.cadences} saving={annualSaving} />
              </div>
              <StatusBanner
                type="info"
                title="Before you pay: inventory is real, not infinite"
                body="Introductions depend on qualified, verified members in your city. If we can't introduce you in a paid week, you receive a protected credit that extends your membership."
              />
              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                {paidPlans.map((p) => (
                  <PlanCard
                    key={p.id}
                    plan={p}
                    cadence={cadence}
                    busy={busy === p.id}
                    onChoose={() => checkout(p.id)}
                    featured={p.id === "pro"}
                  />
                ))}
              </div>
              <Compare plans={all} />
              <p className="mb-6 mt-3 text-xs leading-relaxed text-ink-tertiary">{plans.data.renewal_terms}</p>
            </>
          )}

          {ent.paid && activePlan && (
            <Card className="mb-4">
              <h2 className="display mb-3 text-xl font-bold">What your plan includes</h2>
              <PlanLists plan={activePlan} />
              <p className="text-xs leading-relaxed text-ink-tertiary">{plans.data.renewal_terms}</p>
            </Card>
          )}
          {ent.paid && <Compare plans={all} current={ent.plan} />}

          <Card className="mb-4 mt-4">
            <h2 className="display mb-2 text-xl font-bold">Protected credits</h2>
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
            <h2 className="display mb-2 text-xl font-bold">Principles</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-secondary">
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

function CadenceToggle({ value, onChange, cadences, saving }: { value: string; onChange: (v: string) => void; cadences: string[]; saving: number }) {
  return (
    <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-[var(--radius-pill)] border border-border-strong bg-surface p-1">
      {cadences.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={cx(
            "rounded-[var(--radius-pill)] px-4 py-2 text-sm font-semibold capitalize transition-colors",
            value === c ? "bg-action text-ink-inverse" : "text-ink-secondary hover:bg-surface-muted",
          )}
        >
          {c}
          {/* The saving as money, not as a percentage of a base nobody states. */}
          {c === "annual" && saving > 0 && <span className="ml-1.5 font-normal opacity-80">save {euro(saving)}</span>}
        </button>
      ))}
    </div>
  );
}

function PlanCard({ plan, cadence, busy, onChoose, featured }: { plan: Plan; cadence: string; busy: boolean; onChoose: () => void; featured?: boolean }) {
  const price = plan.prices[cadence];
  const annual = cadence === "annual";
  return (
    <Card className={cx("flex flex-col", featured && "border-action ring-1 ring-action")}>
      {featured && <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-action">Most chosen</p>}
      <h3 className="display text-2xl font-bold text-ink">{plan.name}</h3>
      <p className="mt-1 text-sm text-ink-secondary">{plan.tagline}</p>
      <p className="mt-4 text-3xl font-bold text-ink">
        {euro(price.cents)}
        <span className="text-sm font-normal text-ink-secondary"> / {annual ? "year" : "month"}</span>
      </p>
      {annual && (
        <p className="mt-1 text-sm text-ink-secondary">
          {euro(price.monthly_equivalent_cents)} a month, billed once. Ten months for twelve.
        </p>
      )}
      <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink">
        {plan.included.slice(0, plan.features.length).map((i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="text-action">✓</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <Button fullWidth loading={busy} variant={featured ? "primary" : "secondary"} onClick={onChoose}>
          Start {plan.name}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The ladder, side by side. Built from each plan's `features` list — the same list the API uses to
 * compute entitlements — so a row can never claim something the plan does not actually grant.
 */
function Compare({ plans, current }: { plans: Plan[]; current?: string }) {
  if (plans.length === 0) return null;
  return (
    <Card>
      <h2 className="display mb-3 text-xl font-bold">Compare</h2>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr>
              <th scope="col" className="w-2/5 py-2 text-left font-semibold text-ink-secondary">
                Feature
              </th>
              {plans.map((p) => (
                <th key={p.id} scope="col" className={cx("py-2 text-center font-semibold", p.id === current ? "text-action" : "text-ink")}>
                  {p.name}
                  {p.id === current && <span className="block text-[0.6875rem] font-bold uppercase tracking-[0.14em]">Yours</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">
                  {row.label}
                </th>
                {plans.map((p) => {
                  const has = p.features.includes(row.key);
                  return (
                    <td key={p.id} className="py-2.5 text-center">
                      <span className={cx("text-base", has ? "text-success" : "text-ink-tertiary")} aria-hidden>
                        {has ? "✓" : "—"}
                      </span>
                      <span className="sr-only">{has ? "included" : "not included"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="border-t border-border">
              <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">
                Introductions a week
              </th>
              {plans.map((p) => (
                <td key={p.id} className="py-2.5 text-center text-ink">
                  up to {p.weekly_intro_cap}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-tertiary">
        Safety tools, blocking, reporting, check-ins and appeals are on every plan including the free one, and always
        will be. No plan buys boosts, priority reach or access to a specific person — we do not sell them at any price.
      </p>
    </Card>
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
