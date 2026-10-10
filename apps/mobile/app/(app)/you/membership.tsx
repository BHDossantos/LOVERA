import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useAuth, useRequireMember } from "@/lib/auth";
import { euro, formatDate } from "@/lib/format";
import { Button, Card, ChoiceCard, Divider, ErrorState, Loading, PageTitle, Screen, StatusBanner } from "@/components/ui";
import type { Capabilities } from "@/api/types";
import { color, space, type as typo } from "@/theme";

/**
 * Y06 Membership and credits.
 *
 * Four endpoints the phone reached none of — `GET /plans`, `GET /subscriptions/current`,
 * `POST /subscriptions/cancel`, `POST /subscriptions/checkout` — so a member who subscribed on the
 * web could not see their plan, what it includes, their protected credits or their renewal date
 * from the app, and could not cancel there either. The You tab did not even link to it.
 *
 * **This screen deliberately does not sell anything, and that is not an omission.** Apple
 * guideline 3.1.1 requires in-app purchase for a digital subscription, and there is no StoreKit or
 * Play Billing in this repo. The two ways to fill that gap are both worse than leaving it:
 *
 *   - a checkout button would have to use IAP, which does not exist yet;
 *   - a link out to the web checkout is the specific thing 3.1.1 prohibits, and shipping one is a
 *     rejection rather than a risk.
 *
 * So the free plan is shown as what it is, with the paid plan described honestly and no way to buy
 * it from the phone. A member on the free plan is not nagged; a member who already pays gets
 * everything they need — including cancelling, which is allowed and which they should never have to
 * leave the app or contact support to do.
 *
 * Nothing here is a placeholder: every number comes from the API, and `cancel` really cancels.
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
  /** Kept by the API for clients written before annual existed. */
  price_cents: number;
};
type PlansOut = { plans: Plan[]; cadences: string[]; renewal_terms: string; principles: string[] };

/** The comparison rows, in the order somebody weighing the ladder actually cares about. */
const COMPARE: [string, string][] = [
  ["weekly_introductions", "Weekly introductions"],
  ["adaptive_refresh", "Adaptive Blueprint"],
  ["ai_wingman", "AI Wingman drafts"],
  ["translation", "Translation"],
  ["date_concierge", "Date concierge"],
  ["protected_credits", "Protected credits"],
  ["human_review", "Human matchmaker review"],
  ["priority_coordination", "Priority coordination"],
];
type Ledger = { id: string; amount: number; reason: string; balance_after: number; created_at: string; expires_at: string | null };
type Current = { entitlements: Capabilities["entitlements"]; ledger: Ledger[] };

const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: "met_someone", label: "I met someone" },
  { value: "taking_a_break", label: "Taking a break from dating" },
  { value: "not_enough_introductions", label: "Not enough introductions" },
  { value: "too_expensive", label: "Too expensive right now" },
  { value: "other", label: "Something else" },
];

function Bullets({ items, muted, glyph }: { items: string[]; muted?: boolean; glyph: string }) {
  return (
    <View style={{ marginTop: 4 }}>
      {items.map((i) => (
        <View key={i} style={{ flexDirection: "row", gap: space.sm, marginBottom: 4 }}>
          <Text style={{ color: color.inkTertiary }} accessibilityElementsHidden importantForAccessibility="no">
            {glyph}
          </Text>
          <Text style={{ ...typo.small, color: muted ? color.inkSecondary : color.ink, flex: 1 }}>{i}</Text>
        </View>
      ))}
    </View>
  );
}

export default function Membership() {
  const { me } = useRequireMember();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => get<PlansOut>("/plans"), enabled: !!me });
  const current = useQuery({ queryKey: ["subscription"], queryFn: () => get<Current>("/subscriptions/current"), enabled: !!me });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("taking_a_break");

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/subscriptions/cancel", { reason });
      await qc.invalidateQueries({ queryKey: ["subscription"] });
      // The plan a member is on decides what Today, the introductions list and the conversation
      // screen are allowed to offer, so the capability snapshot has to be refetched with it. That
      // snapshot is not a react-query entry on this client — it lives in the auth context — so
      // invalidating a `["me"]` key would have been a silent no-op. `check_query_keys.py` caught
      // exactly that in the first version of this screen.
      await refresh();
      setConfirming(false);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const ent = current.data?.entitlements;
  const all = plans.data?.plans ?? [];
  const paidPlans = all.filter((p) => p.price_cents > 0);
  const mine = all.find((p) => p.id === ent?.plan);
  const endsLabel = ent?.renews_at ? formatDate(ent.renews_at) : "the end of the paid period";

  return (
    <Screen>
      <PageTitle
        eyebrow="You · Membership"
        title="Membership and credits"
        lede="One price, stated plainly. We charge for the work of matching and coordination, never for trust, safety, privacy or control."
      />
      <ErrorState error={error ?? ((plans.error as ApiError) ?? (current.error as ApiError) ?? null)} retry={() => { void plans.refetch(); void current.refetch(); }} />
      {(plans.isLoading || current.isLoading) && <Loading label="Loading membership" />}

      {!!ent && !!plans.data && (
        <>
          <Card>
            <Text style={{ ...typo.heading, color: color.ink }}>Your plan: {ent.plan_name}</Text>
            <View style={{ marginTop: space.sm }}>
              {(
                [
                  ["Status", ent.paid ? (ent.cancel_at_period_end ? "Cancelled · access continues" : ent.status === "past_due" ? "Payment failed" : "Active") : "Free"],
                  // What this member agreed to pay, which is not necessarily today's catalog price.
              ["Price", ent.paid ? `${euro(ent.price_cents)} / ${ent.cadence === "annual" ? "year" : "month"}` : "Free"],
                  [ent.cancel_at_period_end ? "Access ends" : "Renews", ent.renews_at ? formatDate(ent.renews_at) : "—"],
                  ["Introductions per week", `up to ${ent.weekly_intro_cap}, when inventory supports it`],
                  ["Protected credits", `${ent.protected_credits}`],
                  ...(ent.paid ? [] : [["Trial introductions left", `${ent.trial_introductions_remaining}`] as [string, string]]),
                ] as [string, string][]
              ).map(([k, v]) => (
                <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: 6 }}>
                  <Text style={{ ...typo.small, color: color.inkSecondary }}>{k}</Text>
                  <Text style={{ ...typo.small, color: color.ink, flexShrink: 1, textAlign: "right" }}>{v}</Text>
                </View>
              ))}
            </View>
            {ent.status === "past_due" && (
              <StatusBanner
                tone="caution"
                title="Your last payment didn't go through"
                body="Nothing is lost. Your plan continues for now — update your payment method where you subscribed to keep it."
              />
            )}
          </Card>

          {!!mine && ent.paid && (
            <Card>
              <Text style={{ ...typo.heading, color: color.ink }}>What your plan includes</Text>
              <Bullets items={mine.included} glyph="✓" />
              {mine.not_included.length > 0 && (
                <>
                  <Divider />
                  <Text style={{ ...typo.small, color: color.inkSecondary, fontWeight: "600" }}>Not included</Text>
                  <Bullets items={mine.not_included} glyph="—" muted />
                </>
              )}
              <Text style={{ ...typo.small, color: color.inkTertiary, marginTop: space.sm }}>{plans.data.renewal_terms}</Text>
            </Card>
          )}

          {/* The ladder, described accurately, with no way to buy it from here.
              See the note at the top of this file — a web checkout link is the one thing guideline
              3.1.1 explicitly prohibits, so there is no button and no link, just the truth. */}
          {!ent.paid &&
            paidPlans.map((p) => (
              <Card key={p.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.sm }}>
                  <Text style={{ ...typo.title, color: color.ink }}>{p.name}</Text>
                  <Text style={{ ...typo.heading, color: color.ink }}>
                    {euro(p.prices.monthly.cents)}
                    <Text style={{ ...typo.small, color: color.inkSecondary }}> / month</Text>
                  </Text>
                </View>
                <Text style={{ ...typo.small, color: color.inkSecondary, marginTop: 2 }}>{p.tagline}</Text>
                {/* Annual as a price with its per-month equivalent beside it. "Save 17%" is how
                    subscription pricing hides the number that matters. */}
                {p.annual_saving_cents > 0 && (
                  <Text style={{ ...typo.small, color: color.inkSecondary, marginTop: space.xs }}>
                    Or {euro(p.prices.annual.cents)} a year — {euro(p.prices.annual.monthly_equivalent_cents)} a month,
                    billed once. That is ten months for twelve, saving {euro(p.annual_saving_cents)}.
                  </Text>
                )}
                <Bullets items={p.included.slice(0, p.features.length)} glyph="✓" />
              </Card>
            ))}

          {!ent.paid && (
            <Card>
              <StatusBanner
                tone="context"
                title="Introductions depend on real people, not on paying"
                body="They depend on qualified, verified members in your city. If a paid week passes without one, you get a protected credit that extends your membership rather than a worse introduction."
              />
              <Text style={{ ...typo.small, color: color.inkSecondary }}>
                Neither paid plan is sold in the app. We would have to either charge through the App Store or send you
                to a web page to pay, and the second is not something an app is allowed to do. If you already pay, your
                plan and everything in it appear here.
              </Text>
              <Text style={{ ...typo.small, color: color.inkTertiary, marginTop: space.sm }}>{plans.data.renewal_terms}</Text>
            </Card>
          )}

          {all.length > 1 && (
            <Card>
              <Text style={{ ...typo.title, color: color.ink, marginBottom: space.sm }}>Compare</Text>
              <View style={{ flexDirection: "row", paddingBottom: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
                <Text style={{ ...typo.caption, color: color.inkSecondary, flex: 1 }}>FEATURE</Text>
                {all.map((p) => (
                  <Text
                    key={p.id}
                    style={{ ...typo.caption, color: p.id === ent.plan ? color.action : color.inkSecondary, width: 62, textAlign: "center" }}
                    numberOfLines={1}
                  >
                    {p.name.toUpperCase()}
                  </Text>
                ))}
              </View>
              {COMPARE.map(([key, label]) => (
                <View key={key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: color.border }}>
                  <Text style={{ ...typo.small, color: color.ink, flex: 1, paddingRight: space.sm }}>{label}</Text>
                  {all.map((p) => {
                    const has = p.features.includes(key);
                    return (
                      <Text
                        key={p.id}
                        accessibilityLabel={`${label}, ${p.name}: ${has ? "included" : "not included"}`}
                        style={{ ...typo.small, color: has ? color.success : color.inkTertiary, width: 62, textAlign: "center", fontWeight: "700" }}
                      >
                        {has ? "✓" : "—"}
                      </Text>
                    );
                  })}
                </View>
              ))}
              <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 7 }}>
                <Text style={{ ...typo.small, color: color.ink, flex: 1, paddingRight: space.sm }}>Introductions a week</Text>
                {all.map((p) => (
                  <Text key={p.id} style={{ ...typo.small, color: color.ink, width: 62, textAlign: "center" }}>
                    up to {p.weekly_intro_cap}
                  </Text>
                ))}
              </View>
              <Divider />
              <Text style={{ ...typo.small, color: color.inkTertiary }}>
                Safety tools, blocking, reporting, check-ins and appeals are on every plan including the free one, and
                always will be. No plan buys boosts, priority reach or access to a specific person.
              </Text>
            </Card>
          )}

          <Card>
            <Text style={{ ...typo.heading, color: color.ink }}>Protected credits</Text>
            <Text style={{ ...typo.small, color: color.inkSecondary, marginTop: 4 }}>
              A credit is added whenever a paid week passes without a qualified introduction. Credits extend your
              membership; they are never a reason to lower what you said you need.
            </Text>
            {current.data?.ledger.length === 0 && (
              <Text style={{ ...typo.small, color: color.inkTertiary, marginTop: space.sm }}>No credit movements yet.</Text>
            )}
            {current.data?.ledger.map((l) => (
              <View key={l.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: 6 }}>
                <Text style={{ ...typo.small, color: color.ink, flexShrink: 1 }}>
                  {l.amount > 0 ? "+" : ""}
                  {l.amount} · {l.reason.replace(/_/g, " ")}
                </Text>
                <Text style={{ ...typo.small, color: color.inkSecondary }}>
                  {formatDate(l.created_at)} · balance {l.balance_after}
                </Text>
              </View>
            ))}
          </Card>

          <Card>
            <Text style={{ ...typo.heading, color: color.ink }}>Principles</Text>
            <Bullets items={plans.data.principles} glyph="·" muted />
          </Card>

          {ent.paid && !ent.cancel_at_period_end && !confirming && (
            <Button variant="danger" onPress={() => setConfirming(true)}>
              Cancel my membership
            </Button>
          )}

          {confirming && (
            <Card>
              <Text style={{ ...typo.heading, color: color.ink }}>Cancel your membership?</Text>
              <Text style={{ ...typo.small, color: color.inkSecondary, marginTop: 4 }}>
                Your access continues until {endsLabel}. After that you keep your profile, your conversations, every
                safety tool and one trial introduction on the free plan. Nobody needs to be contacted, and you can
                rejoin whenever you like.
              </Text>
              <Divider />
              <Text style={{ ...typo.small, color: color.inkSecondary, fontWeight: "600", marginBottom: space.sm }}>
                Why, if you want to say (optional)
              </Text>
              {CANCEL_REASONS.map((r) => (
                <ChoiceCard key={r.value} title={r.label} selected={reason === r.value} onSelect={() => setReason(r.value)} />
              ))}
              <View style={{ marginTop: space.md, gap: space.sm }}>
                <Button variant="danger" loading={busy} onPress={cancel}>
                  Cancel at the end of the period
                </Button>
                <Button variant="secondary" onPress={() => setConfirming(false)}>
                  Keep my membership
                </Button>
              </View>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
