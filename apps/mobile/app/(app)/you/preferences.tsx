import { useState } from "react";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Text, View } from "react-native";
import { ApiError, del, get, patch, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { Badge, Button, Card, Chip, ChipGroup, Divider, ErrorState, Loading, Options, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * Y04 Preferences and dealbreakers.
 *
 * Must is a hard gate the matcher never relaxes without being told to. Prefer is weighted.
 * Open is used mostly to explain a match. The three tiers only mean something if a member
 * can see the cost of choosing one, so saving is preceded by an impact preview: how many
 * eligible people remain. When a change would leave almost nobody, it says so before the
 * save rather than leaving someone to conclude the product is empty.
 *
 * Nothing here nudges toward relaxing a safety or core-values preference. The number is
 * shown; the choice stays the member's.
 */
type Option = { value: string; label: string };
type Pref = {
  id: string;
  key: string;
  label: string;
  description: string;
  tier: string;
  operator: string;
  value: Record<string, unknown>;
  options: Option[] | null;
  /**
   * False when the matcher is ignoring this criterion even though it is still stored — today
   * that means a sensitive preference whose special-category consent was withdrawn. The badge
   * has to stop saying "Must", because the one thing a Must promises is that it is enforced.
   */
  active: boolean;
  inactive_reason: string | null;
  updated_at: string | null;
};
type Available = { key: string; label: string; description: string; default_tier: string; operator: string; options: Option[] | null };
type PrefsOut = { preferences: Pref[]; available: Available[]; tier_meaning: Record<string, string> };
type Impact = { key: string; tier: string; eligible_now: number; eligible_after: number; pool_size: number; message: string };

type Editing = {
  key: string;
  label: string;
  description: string;
  operator: string;
  options: Option[] | null;
  tier: string;
  value: Record<string, unknown>;
};

/**
 * The API returns `options: null` for any preference whose target is not a blueprint signal
 * (`preferences_payload` in blueprint/service.py), and `languages` targets profile.languages.
 * Without a fallback the chooser is skipped entirely and the preference saves as an empty
 * list, so the member cannot express the thing the screen is offering. The web app supplies
 * the same list for the same reason.
 */
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "it", label: "Italiano" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ca", label: "Català" },
  { value: "other", label: "Other" },
];

const optionsFor = (key: string, given: Option[] | null) =>
  given ?? (key === "languages" ? LANGUAGE_OPTIONS : null);

const TIERS = [
  { value: "must", label: "Must", body: "A hard gate. Never relaxed without you." },
  { value: "prefer", label: "Prefer", body: "Weighted in ranking." },
  { value: "open", label: "Open", body: "Used lightly, mostly to explain a match." },
];

/**
 * The four the API refuses to delete (`delete_preference` in blueprint/router.py): age,
 * distance, children and relationship structure are eligibility, so they are set to Open
 * rather than removed. Offering a Remove button that always 409s would be worse than offering
 * none, so these do not get one.
 */
const CANNOT_REMOVE = ["age_range", "distance_km", "children", "relationship_structure"];

/** Identifies an edit by exactly the values the impact preview is computed from. */
const signature = (e: Editing) => JSON.stringify([e.key, e.tier, e.value]);

function describe(p: { value: Record<string, unknown>; options: Option[] | null }) {
  const v = p.value as { min?: number; max?: number; in?: string[]; any_of?: string[] };
  if (typeof v.min === "number" && typeof v.max === "number") return `${v.min}–${v.max}`;
  if (typeof v.max === "number") return `up to ${v.max} km`;
  const list = v.in ?? v.any_of ?? [];
  if (!list.length) return "Anything";
  return list.map((x) => p.options?.find((o) => o.value === x)?.label ?? x.replace(/_/g, " ")).join(", ");
}

export default function YouPreferences() {
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  // The preview is stored with a signature of the values it was computed for. Clearing it on
  // every edit was not enough: a request already in flight would resolve afterwards and put
  // it back, enabling Save for a value nobody had costed. Cancelling and opening another
  // preference while one was pending did the same. Comparing signatures discards a stale
  // response instead of racing it.
  const [impact, setImpact] = useState<{ sig: string; data: Impact } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const q = useQuery({ queryKey: ["preferences"], queryFn: () => get<PrefsOut>("/preferences"), enabled: !!me });

  const open = (p: Pref) => {
    setEditing({
      key: p.key,
      label: p.label,
      description: p.description,
      operator: p.operator,
      options: optionsFor(p.key, p.options),
      tier: p.tier,
      value: { ...p.value },
    });
    setImpact(null);
  };

  const add = (a: Available) => {
    const value: Record<string, unknown> =
      a.key === "age_range" ? { min: 25, max: 45 } : a.key === "distance_km" ? { max: 25 } : a.operator === "any_of" ? { any_of: [] } : { in: [] };
    setEditing({
      key: a.key,
      label: a.label,
      description: a.description,
      operator: a.operator,
      options: optionsFor(a.key, a.options),
      tier: a.default_tier,
      value,
    });
    setImpact(null);
  };

  const preview = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const sig = signature(editing);
      const data = await post<Impact>("/preferences/impact-preview", {
        key: editing.key,
        tier: editing.tier,
        value: editing.value,
      });
      setImpact({ sig, data });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Clear a preference back to unset.
   *
   * Setting one to Open is not the same thing: Open still weighs it, so a member who decides
   * a criterion should play no part at all had no way to say so, and the one endpoint that
   * does it was never called from either app.
   */
  const remove = async (key: string) => {
    setBusy(true);
    setError(null);
    try {
      await del(`/preferences/${key}`);
      await qc.invalidateQueries({ queryKey: ["preferences"] });
      setEditing(null);
      setImpact(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (key: string, label: string) =>
    Alert.alert(
      `Stop using ${label} entirely?`,
      "It will play no part in your matches until you set it again. This is not the same as Open, which still weighs it lightly.",
      [
        { text: "Keep it", style: "cancel" },
        { text: "Stop using it", style: "destructive", onPress: () => void remove(key) },
      ],
    );

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await patch(`/preferences/${editing.key}`, { tier: editing.tier, value: editing.value });
      await qc.invalidateQueries({ queryKey: ["preferences"] });
      setEditing(null);
      setImpact(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading your preferences" />
      </Screen>
    );

  // Only a preview computed for exactly these values counts.
  const costed = editing && impact?.sig === signature(editing) ? impact.data : null;
  // A change that leaves almost nobody eligible is worth naming before it is saved.
  const overFiltering =
    !!costed && costed.eligible_after < costed.eligible_now && (costed.eligible_after <= 3 || costed.eligible_after < costed.eligible_now / 2);
  const listKey = editing?.operator === "any_of" ? "any_of" : "in";
  const list = (editing?.value[listKey] as string[] | undefined) ?? [];

  if (editing)
    return (
      <Screen>
        <PageTitle eyebrow="You · Preferences" title={editing.label} lede={editing.description} />
        <ErrorState error={error} />

        <Card>
          <Text style={s.h2}>How strict</Text>
          <Options
            value={editing.tier}
            options={TIERS}
            onChange={(tier) => {
              setEditing({ ...editing, tier });
              setImpact(null);
            }}
          />
        </Card>

        {!!editing.options && (
          <Card>
            <Text style={s.h2}>What you'll accept</Text>
            <ChipGroup
              values={list}
              options={editing.options}
              onChange={(next) => {
                setEditing({ ...editing, value: { ...editing.value, [listKey]: next } });
                setImpact(null);
              }}
            />
          </Card>
        )}

        {!editing.options && (
          <Card>
            <Text style={s.h2}>Current setting</Text>
            <Text style={s.meta}>{describe(editing)}</Text>
            <Text style={s.fine}>
              Ranges are set during the blueprint interview. Changing the strictness here is enough for most people.
            </Text>
          </Card>
        )}

        <Card>
          <Text style={s.h2}>What this costs you</Text>
          {!costed && <Text style={s.meta}>See how many people would still be eligible before you save.</Text>}
          {!!costed && (
            <>
              <Text style={s.meta}>{costed.message}</Text>
              <Text style={s.big}>
                {costed.eligible_after} of {costed.pool_size}
              </Text>
              <Text style={s.fine}>eligible after this change, from {costed.eligible_now} now</Text>
            </>
          )}
          {overFiltering && (
            <StatusBanner
              tone="caution"
              title="This leaves very few people"
              body="It is yours to choose, and we will not relax it quietly. You may simply wait longer between introductions."
            />
          )}
          <Button variant="secondary" loading={busy} onPress={preview}>
            {costed ? "Check again" : "Check the impact"}
          </Button>
        </Card>

        {/* This screen's whole claim is that you see the cost before you commit, and the
            Save button was available before the preview had ever run — so a member could
            set a Must criterion and never be shown what it costs. The preview is cleared by
            every edit, so this also forces a fresh one after a change. */}
        <Button disabled={!costed} loading={busy} onPress={save}>
          {costed ? "Save" : "Check the impact first"}
        </Button>
        <Button
          variant="ghost"
          onPress={() => {
            setEditing(null);
            setImpact(null);
          }}
        >
          Cancel
        </Button>
        {/* Only for a preference that is actually set, and only where the API will accept it. */}
        {!CANNOT_REMOVE.includes(editing.key) && q.data?.preferences.some((p) => p.key === editing.key) && (
          <Button variant="ghost" loading={busy} onPress={() => confirmRemove(editing.key, editing.label)}>
            Stop using this preference
          </Button>
        )}
      </Screen>
    );

  return (
    <Screen>
      <PageTitle
        eyebrow="You · Preferences"
        title="Preferences and dealbreakers"
        lede="Must is a hard gate we never relax without you. Prefer is weighted. Open is used lightly. We show the trade-off before you save."
      />
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />

      {q.data?.preferences.map((p) => (
        <Card key={p.key}>
          <View style={s.row}>
            <Text style={s.h2}>{p.label}</Text>
            <Badge label={p.active === false ? "not in use" : p.tier} tone={p.active !== false && p.tier === "must" ? "caution" : "muted"} />
          </View>
          <Text style={s.meta}>{describe(p)}</Text>
          {p.active === false && (
            <Text style={s.meta}>
              You withdrew consent for sensitive data, so this is not being applied to your introductions. Your setting
              is kept — granting that consent again in Privacy puts it back in use.
            </Text>
          )}
          {p.active !== false ? (
            <Button variant="secondary" onPress={() => open(p)}>
              Change
            </Button>
          ) : (
            <Button variant="ghost" onPress={() => router.push("/you/privacy")}>
              Review your consents
            </Button>
          )}
        </Card>
      ))}

      {!!q.data?.available.length && (
        <>
          <Divider />
          <Text style={s.h2}>Add a preference</Text>
          {q.data.available.map((a) => (
            <Card key={a.key}>
              <Text style={s.h2}>{a.label}</Text>
              <Text style={s.meta}>{a.description}</Text>
              <Button variant="ghost" onPress={() => add(a)}>
                Set this up
              </Button>
            </Card>
          ))}
        </>
      )}

      <Text style={s.fine}>
        Must: {q.data?.tier_meaning.must} Prefer: {q.data?.tier_meaning.prefer} Open: {q.data?.tier_meaning.open}
      </Text>
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
  big: { ...typo.title, color: color.ink },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.xs },
} as const;
