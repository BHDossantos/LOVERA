import { useState } from "react";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { Blueprint, BlueprintSignal } from "@/api/types";
import { Badge, Button, Card, Divider, ErrorState, Loading, Options, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * Y02 Your blueprint.
 *
 * What the matcher believes about you, in plain words, with the evidence it came from and
 * how confident it is — and a way to say "that's wrong". A member should never have to argue
 * with an inference they cannot see, and correcting one marks it member-corrected so it is
 * never quietly overwritten by a later inference.
 *
 * Special-category signals (orientation, faith) are marked, because a member should be able
 * to tell at a glance which of these are the sensitive ones.
 */
const CATEGORY_LABEL: Record<string, string> = {
  life_plan: "Life plans",
  daily: "Day to day",
  values: "Values",
  interaction: "How you connect",
  readiness: "Readiness",
};

export default function YouBlueprint() {
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BlueprintSignal | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const q = useQuery({ queryKey: ["blueprint"], queryFn: () => get<Blueprint>("/blueprint/current"), enabled: !!me });

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/blueprint/signals/${editing.key}`, { tier: "must", value: { value } });
      await qc.invalidateQueries({ queryKey: ["blueprint"] });
      setEditing(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading your blueprint" />
      </Screen>
    );

  if (editing)
    return (
      <Screen>
        <PageTitle eyebrow="Correct this" title={editing.label} lede={editing.evidence ?? undefined} />
        <ErrorState error={error} />
        <Card>
          <Options value={value} options={editing.options} onChange={setValue} />
        </Card>
        <Text style={s.fine}>
          Your correction replaces what we inferred and is marked as yours, so a later inference cannot quietly
          overwrite it. Matching recalculates after you save.
        </Text>
        <Button disabled={!value || value === editing.value} loading={busy} onPress={save}>
          Save my correction
        </Button>
        <Button variant="ghost" onPress={() => setEditing(null)}>
          Cancel
        </Button>
      </Screen>
    );

  const byCategory = (q.data?.signals ?? []).reduce<Record<string, BlueprintSignal[]>>((acc, sig) => {
    (acc[sig.category] ??= []).push(sig);
    return acc;
  }, {});

  return (
    <Screen>
      <PageTitle
        eyebrow="You · Blueprint"
        title="What we think we know"
        lede="Built from your interview answers, never from your photos, your private messages or anything you reported."
      />
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />

      {!q.data?.version && (
        <StatusBanner
          tone="context"
          title="No confirmed blueprint yet"
          body="Finish the interview and confirm it, and everything the matcher uses will be listed here."
        />
      )}

      {!!q.data?.freshness.stale && (
        <StatusBanner
          tone="caution"
          title="This is getting old"
          body={`Confirmed ${q.data.freshness.age_days} days ago. People change; refreshing it improves who you are shown.`}
        />
      )}

      {Object.entries(byCategory).map(([category, signals]) => (
        <View key={category}>
          <Text style={s.section}>{CATEGORY_LABEL[category] ?? category}</Text>
          {signals.map((sig) => (
            <Card key={sig.key}>
              <View style={s.row}>
                <Text style={s.h2}>{sig.label}</Text>
                {sig.member_corrected && <Badge label="Yours" tone="success" />}
                {sig.special_category && !sig.member_corrected && <Badge label="Sensitive" tone="caution" />}
              </View>
              <Text style={s.body}>{sig.value_label || sig.value || "—"}</Text>
              {!!sig.evidence && <Text style={s.meta}>{sig.evidence}</Text>}
              <Text style={s.fine}>Confidence: {sig.confidence}</Text>
              {sig.options.length > 0 && (
                <Button
                  variant="ghost"
                  onPress={() => {
                    setEditing(sig);
                    setValue(sig.value ?? "");
                    setError(null);
                  }}
                >
                  That's not right
                </Button>
              )}
            </Card>
          ))}
        </View>
      ))}

      <Divider />
      <Text style={s.fine}>{q.data?.data_use}</Text>
      {!!q.data?.version && (
        <Text style={s.fine}>
          Version {q.data.version.version_no}
          {q.data.version.confirmed_at ? `, confirmed ${new Date(q.data.version.confirmed_at).toLocaleDateString()}` : ""}
        </Text>
      )}
      <Button variant="ghost" onPress={() => router.back()}>
        Done
      </Button>
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  h2: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  body: { ...typo.body, color: color.ink, marginTop: 2 },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: space.xs },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.xs },
  section: { ...typo.title, color: color.ink, marginTop: space.lg, marginBottom: space.sm },
} as const;
