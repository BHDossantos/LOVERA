import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ApiError, get, newIdempotencyKey, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { CATEGORY_LABEL, URGENCY, type SafetyCase, type SafetyCenter } from "@/components/safety";
import {
  Button,
  Card,
  ErrorState,
  Field,
  Options,
  PageTitle,
  Screen,
  StatusBanner,
  TextInput,
  Toggle,
} from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * S02 Report. Block first, minimum questions, skippable narrative, and a receipt.
 *
 * Both stores require a reporting path this direct for an app carrying user-generated
 * content. It is also just the right shape: somebody using this screen is often having
 * the worst day of their year, and should not have to write an essay to be heard.
 */
export default function Report() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const router = useRouter();
  const params = useLocalSearchParams<{ subject?: string; conversation?: string; date?: string }>();
  const center = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetyCenter>("/safety"), enabled: !!me });

  const [category, setCategory] = useState("");
  const [urgency, setUrgency] = useState("recent");
  const [narrative, setNarrative] = useState("");
  const [blockNow, setBlockNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [receipt, setReceipt] = useState<SafetyCase | null>(null);
  const [key] = useState(() => newIdempotencyKey());

  const categories = center.data?.categories ?? Object.keys(CATEGORY_LABEL).map((k) => ({ key: k, severity: "" }));
  const severity = categories.find((c) => c.key === category)?.severity ?? "";
  const severe = severity === "P0" || severity === "P1" || urgency === "happening_now";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<SafetyCase>(
        "/safety/reports",
        {
          subject_id: params.subject ?? null,
          category,
          urgency,
          narrative: narrative.trim() || null,
          conversation_id: params.conversation ?? null,
          date_plan_id: params.date ?? null,
          block_now: !!params.subject && blockNow,
          entry_surface: params.date ? "date" : params.conversation ? "conversation" : "safety_center",
        },
        { idempotencyKey: key },
      );
      setReceipt(r);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (receipt)
    return (
      <Screen>
        <PageTitle eyebrow="Reported" title="Thank you. It's on record." />
        <StatusBanner
          tone="success"
          title="We have your report"
          body={
            receipt.acknowledgement_due_at
              ? `A human acknowledges this by ${new Date(receipt.acknowledgement_due_at).toLocaleString()}.`
              : "A human reviews this and will acknowledge it."
          }
        />
        <Card>
          <Text style={s.note}>
            The person you reported is never told that you reported them, or what you said. If you blocked them,
            that took effect immediately.
          </Text>
        </Card>
        <Button onPress={() => router.replace(`/safety/cases/${receipt.id}` as never)}>See the case</Button>
        <Button variant="ghost" onPress={() => router.replace("/safety" as never)}>
          Back to the safety centre
        </Button>
      </Screen>
    );

  return (
    <Screen>
      <PageTitle
        eyebrow="Report"
        title="What happened?"
        lede="Answer only what you want to. You can stop at any point and the report still counts."
      />
      <ErrorState error={error} />
      {severe && (
        <StatusBanner
          tone="caution"
          title="If you are in immediate danger, contact emergency services first"
          body="We are not an emergency service. This report is handled urgently, but it is not a 999 call."
        />
      )}
      <Card>
        <Field label="What kind of thing is it?">
          <Options
            value={category}
            onChange={setCategory}
            options={categories.map((c) => ({
              value: c.key,
              label: CATEGORY_LABEL[c.key]?.label ?? c.key,
              body: CATEGORY_LABEL[c.key]?.help,
            }))}
          />
        </Field>
      </Card>
      <Card>
        <Field label="When?">
          <Options value={urgency} onChange={setUrgency} options={URGENCY.map((u) => ({ value: u.value, label: u.label, body: u.body }))} />
        </Field>
      </Card>
      {!!params.subject && (
        <Card>
          <Toggle
            value={blockNow}
            onValueChange={setBlockNow}
            label="Block them now"
            description="Immediate and silent. They are never told, and cannot contact you again."
          />
        </Card>
      )}
      <Card>
        <Field label="Anything you want to add" help="Optional. Skip it if you'd rather not write this out.">
          <TextInput
            value={narrative}
            onChangeText={setNarrative}
            multiline
            numberOfLines={5}
            style={{ minHeight: 130, textAlignVertical: "top" }}
            accessibilityLabel="What happened"
          />
        </Field>
      </Card>
      <Button onPress={submit} loading={busy} disabled={!category}>
        Send this report
      </Button>
      <View style={{ marginTop: space.sm }}>
        <Text style={s.note}>
          Reports are read by a person. Nothing you write here is shown to the person you are reporting.
        </Text>
      </View>
    </Screen>
  );
}

const s = {
  note: { ...typo.small, color: color.inkSecondary },
} as const;
