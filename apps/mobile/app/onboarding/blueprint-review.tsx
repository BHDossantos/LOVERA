import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { ApiError, get, post } from "@/api/client";
import type { Strength } from "@/api/types";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { Badge, Button, Card, ErrorState, Loading, Options, PageTitle, Screen, Steps } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

type Signal = {
  key: string;
  category: string;
  label: string;
  value: string | null;
  value_label: string | null;
  options: { value: string; label: string }[];
  confidence: Strength;
  evidence: string | null;
  source: string;
  needs_choice: boolean;
  special_category: boolean;
};
type Pref = { key: string; label: string; tier: string; description?: string };
type Review = {
  session_id: string;
  status: string;
  signals: Signal[];
  preferences: Pref[];
  confidence_wording: Record<string, string>;
  note: string;
};

const TIERS = [
  { value: "must", label: "Must" },
  { value: "prefer", label: "Prefer" },
  { value: "open", label: "Open" },
];

function toneFor(c: Strength) {
  return c === "strong" ? "success" : c === "promising" ? "context" : "muted";
}

/**
 * O06 Blueprint review. Nothing the AI inferred becomes matching data until the member
 * confirms it here — they can correct any value, drop a signal entirely, and set how
 * hard each preference is.
 */
export default function BlueprintReview() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  const { session } = useLocalSearchParams<{ session?: string }>();
  const sessionId = session ?? "";
  const [review, setReview] = useState<Review | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [tiers, setTiers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    post(`/blueprint/sessions/${sessionId}/finish`)
      .catch(() => undefined)
      .then(() => get<Review>(`/blueprint/sessions/${sessionId}/review`))
      .then(setReview)
      .catch((e) => setError(e as ApiError));
  }, [sessionId]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/blueprint/confirm", {
        session_id: sessionId,
        signal_edits: Object.entries(edits).map(([key, value]) => ({ key, value })),
        preference_edits: Object.entries(tiers).map(([key, tier]) => ({ key, tier })),
        removed_signal_keys: removed,
      });
      const m = await refresh();
      if (m) router.replace(nextOnboardingPath(m) as never);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (!review && !error)
    return (
      <Screen scroll={false}>
        <Loading label="Reading your answers back" />
      </Screen>
    );

  return (
    <Screen>
      <Steps step={5} />
      <PageTitle
        eyebrow="Blueprint"
        title="Here's what we understood"
        lede={review?.note ?? "Correct anything that isn't right. Nothing here is used for matching until you confirm it."}
      />
      <ErrorState error={error} />
      {review?.signals.map((sig) => {
        const dropped = removed.includes(sig.key);
        const value = edits[sig.key] ?? sig.value ?? "";
        return (
          <Card key={sig.key} style={dropped ? { opacity: 0.55 } : undefined}>
            <View style={s.row}>
              <Text style={s.label}>{sig.label}</Text>
              <Badge label={review.confidence_wording[sig.confidence] ?? sig.confidence} tone={toneFor(sig.confidence)} />
            </View>
            {!!sig.evidence && <Text style={s.evidence}>{sig.evidence}</Text>}
            {!dropped && (
              <Options
                value={value}
                onChange={(v) => setEdits({ ...edits, [sig.key]: v })}
                options={sig.options.map((o) => ({ value: o.value, label: o.label }))}
              />
            )}
            <Button
              variant="ghost"
              onPress={() => setRemoved(dropped ? removed.filter((k) => k !== sig.key) : [...removed, sig.key])}
            >
              {dropped ? "Keep this after all" : "Don't use this for matching"}
            </Button>
          </Card>
        );
      })}
      {!!review?.preferences.length && (
        <>
          <Text style={s.sectionTitle}>How hard is each one?</Text>
          {review.preferences.map((p) => (
            <Card key={p.key}>
              <Text style={s.label}>{p.label}</Text>
              {!!p.description && <Text style={s.evidence}>{p.description}</Text>}
              <Options
                value={tiers[p.key] ?? p.tier}
                onChange={(v) => setTiers({ ...tiers, [p.key]: v })}
                options={TIERS}
              />
            </Card>
          ))}
        </>
      )}
      <Button onPress={confirm} loading={busy} disabled={!review}>
        Confirm my Blueprint
      </Button>
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.xs },
  label: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  evidence: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
  sectionTitle: { ...typo.title, color: color.ink, marginTop: space.lg, marginBottom: space.sm },
} as const;
