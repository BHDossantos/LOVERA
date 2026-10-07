import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { serverDriven } from "@/lib/query";
import { Button, Card, ErrorState, Loading, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * D06 The second-date result.
 *
 * Only a mutual yes is ever revealed. A one-sided yes, a no, and an answer that has not
 * arrived yet all look identical here, deliberately: if "no mutual result" could be
 * distinguished from "still waiting", a member could work out that the other person said no,
 * which is precisely the rejection this product exists to avoid handing anyone.
 */
type Outcome = {
  state: "awaiting_your_feedback" | "mutual_second_date" | "no_mutual_result_yet";
  mutual: boolean;
  next_steps?: string[];
  conversation_id?: string;
  message?: string;
};

export default function DateOutcome() {
  const { me } = useRequireMember();
  const { dateId } = useLocalSearchParams<{ dateId: string }>();
  const router = useRouter();

  const q = useQuery({
    queryKey: ["date-plan", dateId, "outcome"],
    ...serverDriven,
    queryFn: () => get<Outcome>(`/date-plans/${dateId}/mutual-outcome`),
    enabled: !!me && !!dateId,
  });

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Checking" />
      </Screen>
    );

  const o = q.data;
  return (
    <Screen>
      <PageTitle eyebrow="After the date" title="Second date?" />
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />

      {o?.state === "awaiting_your_feedback" && (
        <>
          <StatusBanner tone="context" title="You haven't answered yet" body="Your answer stays private either way." />
          <Button onPress={() => router.replace(`/dates/${dateId}/feedback` as never)}>Give private feedback</Button>
        </>
      )}

      {o?.state === "mutual_second_date" && (
        <>
          <StatusBanner tone="success" title="You both said yes" />
          <Card>
            {(o.next_steps ?? []).map((n) => (
              <Text key={n} style={s.body}>
                • {n}
              </Text>
            ))}
          </Card>
          {!!o.conversation_id && (
            <Button onPress={() => router.replace(`/messages/${o.conversation_id}` as never)}>
              Back to the conversation
            </Button>
          )}
        </>
      )}

      {o?.state === "no_mutual_result_yet" && (
        <Card>
          <Text style={s.body}>{o.message}</Text>
          <Text style={s.fine}>
            This says the same thing whether they have answered or not, so nothing here can tell you what they chose.
          </Text>
        </Card>
      )}

      <Button variant="ghost" onPress={() => router.replace(`/dates/${dateId}` as never)}>
        Back to the date
      </Button>
    </Screen>
  );
}

const s = {
  body: { ...typo.body, color: color.ink, marginBottom: space.xs },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.sm },
} as const;
