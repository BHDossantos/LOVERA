import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Linking, Text, View } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { telUri } from "@/components/safety";
import type { DatePlan } from "@/api/types";
import { Badge, Button, Card, Divider, ErrorState, Loading, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/** D03 Date detail: the plan, the confirmation, and the safety tools attached to it. */
export default function DateDetail() {
  const { me } = useRequireMember();
  const { dateId } = useLocalSearchParams<{ dateId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const q = useQuery({
    queryKey: ["date-plan", dateId],
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

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading date" />
      </Screen>
    );

  const d = q.data;
  return (
    <Screen>
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />
      {!!d && (
        <>
          <PageTitle
            eyebrow={d.status}
            title={`With ${d.other_display_name}`}
            lede={d.starts_at ? new Date(d.starts_at).toLocaleString() : "Time not settled yet"}
          />
          {d.awaiting_your_confirmation && (
            <StatusBanner tone="context" title="They proposed this. It isn't set until you confirm." />
          )}

          {!!d.venue && (
            <Card>
              <Text style={s.h2}>{d.venue.name}</Text>
              <Text style={s.meta}>{d.venue.coarse_area}</Text>
              <Text style={s.meta}>
                {d.venue.categories.join(", ")} · {d.venue.price_band}
              </Text>
              {d.venue.public_place && <Badge label="Public place" tone="success" />}
              {!!d.venue.travel && (
                <Text style={s.meta}>
                  You {d.venue.travel.you_km_band} · Them {d.venue.travel.them_km_band}
                </Text>
              )}
            </Card>
          )}

          {d.awaiting_your_confirmation && (
            <>
              <Button
                loading={busy === "accept"}
                onPress={() =>
                  run("accept", () =>
                    post(`/date-plans/${d.id}/respond`, { action: "accept" }, { ifMatch: d.version }),
                  )
                }
              >
                Confirm this date
              </Button>
              <Button
                variant="secondary"
                loading={busy === "decline"}
                onPress={() =>
                  run("decline", () =>
                    post(`/date-plans/${d.id}/respond`, { action: "decline" }, { ifMatch: d.version }),
                  )
                }
              >
                Decline
              </Button>
            </>
          )}

          <Card>
            <Text style={s.h2}>Safety</Text>
            {d.check_in ? (
              <Text style={s.meta}>
                Check-in set for {new Date(d.check_in.check_at).toLocaleString()} · shared as {d.check_in.share_scope}
                {d.check_in.trusted_contact_name ? ` with ${d.check_in.trusted_contact_name}` : ""}
              </Text>
            ) : (
              <Text style={s.meta}>
                You can set a check-in: if you don't confirm you're fine, we alert a contact you choose. We never
                share your live location with your date.
              </Text>
            )}
            {(d.status === "confirmed" || !!d.check_in) && (
              <Button variant="secondary" onPress={() => router.push(`/dates/${d.id}/check-in` as never)}>
                {d.check_in ? "Check in, or change it" : "Set up a check-in"}
              </Button>
            )}
            {d.safety.guidance.map((g) => (
              <Text key={g} style={s.guidance}>
                • {g}
              </Text>
            ))}
            <Divider />
            <Button variant="danger" onPress={() => void Linking.openURL(telUri(d.safety.emergency))}>
              {`Emergency: ${d.safety.emergency}`}
            </Button>
            <Button
              variant="secondary"
              onPress={() => router.push(`/safety/report?date=${d.id}` as never)}
            >
              Report something about this date
            </Button>
          </Card>

          {d.feedback_open && !d.feedback_submitted && (
            <Card>
              <Text style={s.h2}>How was it?</Text>
              <Text style={s.meta}>
                Private. A second date is only revealed if you both say yes, and neither of you is told about a no.
              </Text>
              {/* Feedback starts with whether the date happened at all: a no-show changes the
                  plan's status and is how the other person's attendance dispute gets raised,
                  so it cannot be assumed from a second-date answer. */}
              <Button onPress={() => router.push(`/dates/${d.id}/feedback` as never)}>Give private feedback</Button>
            </Card>
          )}
          {d.feedback_submitted && (
            <Card>
              <Text style={s.h2}>Your feedback is saved</Text>
              <Text style={s.meta}>
                If you both said yes to a second date, you will both hear. Nobody is told about a no.
              </Text>
              <Button variant="secondary" onPress={() => router.push(`/dates/${d.id}/outcome` as never)}>
                See if it was mutual
              </Button>
              <Button variant="ghost" onPress={() => router.push(`/dates/${d.id}/feedback` as never)}>
                Change my answers
              </Button>
            </Card>
          )}

          {!["cancelled", "completed", "no_show", "disputed"].includes(d.status) && (
            <Button
              variant="ghost"
              loading={busy === "cancel"}
              onPress={() => run("cancel", () => post(`/date-plans/${d.id}/cancel`, { reason: "other" }))}
            >
              Cancel this date
            </Button>
          )}
          <Text style={s.fine}>{d.cancellation_rules}</Text>
        </>
      )}
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 2, marginBottom: space.sm },
  guidance: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.md },
} as const;
