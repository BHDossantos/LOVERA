import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Linking, Text } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { awaitingServer, serverDriven } from "@/lib/query";
import { telUri } from "@/components/safety";
import type { DatePlan } from "@/api/types";
import { Button, Card, Divider, ErrorState, Field, Loading, Options, PageTitle, Screen, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * D04 Safety check-in.
 *
 * Someone is meeting a stranger. They nominate a contact and a time; if they have not said
 * they are fine by then, that contact is reached through the channel they chose. The date is
 * never told any of this exists.
 *
 * Nothing is shared by default and the scope is the member's choice: the plan alone, the plan
 * plus whether they checked in, or — only if they ask for it — a location note, held for a
 * bounded window and never shown to the other person. Escalating is one tap and needs no
 * reason, because requiring one is exactly the friction you do not want at that moment.
 */
const SCOPES = [
  { value: "plan", label: "Where and when only", body: "Your contact sees the place and the time." },
  { value: "plan_and_checkin", label: "That, plus whether I checked in", body: "They are told if you do not confirm." },
  {
    value: "plan_checkin_location",
    label: "That, plus a location note",
    body: "Only what you type, kept briefly, never shown to your date.",
  },
];

export default function DateCheckIn() {
  const { me } = useRequireMember();
  const { dateId } = useLocalSearchParams<{ dateId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [channel, setChannel] = useState("");
  const [scope, setScope] = useState("plan_and_checkin");
  const [escalation, setEscalation] = useState("contact");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const q = useQuery({
    queryKey: ["date-plan", dateId],
    ...serverDriven,
    queryFn: () => get<DatePlan>(`/date-plans/${dateId}`),
    enabled: !!me && !!dateId,
  });

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ["date-plans"] })]);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  if (awaitingServer(q))
    return (
      <Screen scroll={false}>
        <Loading label="Loading date" />
      </Screen>
    );

  const d = q.data;
  const existing = d?.check_in ?? null;
  const canConfigure = d?.status === "confirmed";

  return (
    <Screen>
      <PageTitle
        eyebrow="Safety check-in"
        title={existing ? "Your check-in" : "Set up a check-in"}
        lede={`If you don't confirm you're fine, we reach the contact you choose. ${d?.other_display_name ?? "The other person"} is never told this exists.`}
      />
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />

      {!canConfigure && !existing && (
        <StatusBanner tone="context" title="Confirm the date first" body="A check-in attaches to a confirmed plan." />
      )}

      {!!existing && (
        <Card>
          <Text style={s.h2}>Active</Text>
          <Text style={s.meta}>
            {new Date(existing.check_at).toLocaleString()} · shared as {existing.share_scope}
            {existing.trusted_contact_name ? ` with ${existing.trusted_contact_name}` : ""}
          </Text>
          <Text style={s.meta}>State: {existing.state}</Text>

          {existing.share_scope === "plan_checkin_location" && (
            <Field label="Location note (optional)" help="Only what you type here, and only until the retention window ends.">
              <TextInput value={note} onChangeText={setNote} placeholder="Corner table, upstairs" maxLength={200} />
            </Field>
          )}
          <Button
            loading={busy === "ok"}
            onPress={() =>
              run("ok", () =>
                post(`/date-plans/${dateId}/check-in/now`, { state: "checked_in", location_note: note || null }),
              )
            }
          >
            I'm fine
          </Button>
          <Divider />
          <Text style={s.meta}>
            If something feels wrong, escalate. You do not need a reason, and nothing is sent to your date.
          </Text>
          <Button
            variant="danger"
            loading={busy === "escalate"}
            onPress={() =>
              run("escalate", () =>
                post(`/date-plans/${dateId}/check-in/now`, { state: "escalated", location_note: note || null }),
              )
            }
          >
            Escalate now
          </Button>
          {!!d?.safety.emergency && (
            <Button variant="secondary" onPress={() => void Linking.openURL(telUri(d.safety.emergency))}>
              {`Call emergency services (${d.safety.emergency})`}
            </Button>
          )}
        </Card>
      )}

      {canConfigure && (
        <Card>
          <Text style={s.h2}>{existing ? "Change it" : "Who should we reach?"}</Text>
          <Field label="Their name">
            <TextInput value={name} onChangeText={setName} placeholder="A friend or family member" maxLength={80} />
          </Field>
          <Field label="How to reach them" help="A phone number or email. We only use it if you don't check in.">
            <TextInput
              value={channel}
              onChangeText={setChannel}
              placeholder="+39 ... or name@example.com"
              maxLength={120}
              autoCapitalize="none"
            />
          </Field>
          <Text style={s.h2}>What they see</Text>
          <Options value={scope} options={SCOPES} onChange={setScope} />
          <Text style={s.h2}>If you don't check in</Text>
          <Options
            value={escalation}
            options={[
              { value: "contact", label: "Reach my contact" },
              { value: "contact_and_support", label: "Reach my contact and the safety team" },
            ]}
            onChange={setEscalation}
          />
          <Button
            disabled={!name.trim() || channel.trim().length < 3}
            loading={busy === "save"}
            onPress={() =>
              run("save", async () => {
                await post(`/date-plans/${dateId}/check-in`, {
                  trusted_contact_name: name.trim(),
                  trusted_contact_channel: channel.trim(),
                  share_scope: scope,
                  escalation_preference: escalation,
                });
                router.replace(`/dates/${dateId}` as never);
              })
            }
          >
            {existing ? "Save changes" : "Set up the check-in"}
          </Button>
        </Card>
      )}
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginTop: space.md, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
} as const;
