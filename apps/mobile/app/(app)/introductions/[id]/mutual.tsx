import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { serverDriven } from "@/lib/query";
import type { Introduction } from "@/api/types";
import { Badge, Button, Card, ErrorState, Loading, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * I05 Mutual acceptance.
 *
 * This route exists because the API's "you both said yes" notification deep-links to
 * /introductions/{id}/mutual. On mobile that path had no screen, so the single most
 * important notification in the product opened nothing at all when tapped.
 *
 * Calm, not confetti: two next steps and the reciprocity rule, which is the part people
 * actually want confirmed — that neither of them saw the other's answer first.
 */
export default function Mutual() {
  const { me } = useRequireMember();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["introduction", id],
    queryFn: () => get<Introduction>(`/introductions/${id}`),
    enabled: !!me && !!id,
    ...serverDriven,
  });

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading" />
      </Screen>
    );

  const intro = q.data;
  const them = intro?.profile;

  return (
    <Screen>
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      {!!intro && intro.status !== "mutual" && (
        <>
          <StatusBanner
            tone="context"
            title="Not mutual yet"
            body="This opens once you have both said yes. Nothing about anyone's one-sided decision is ever shown."
          />
          {/* And something to do about it, rather than a dead end: a refetch is the one action
              that can resolve this state, so it should not need a trip back and in again. */}
          <Button variant="secondary" loading={q.isFetching} onPress={() => void q.refetch()}>
            Check again
          </Button>
          <Button variant="ghost" onPress={() => router.replace(`/introductions/${intro.id}` as never)}>
            Back to the introduction
          </Button>
        </>
      )}
      {!!intro && intro.status === "mutual" && (
        <>
          <PageTitle
            eyebrow="Mutual"
            title={`You and ${them?.display_name ?? "they"} both said yes`}
            lede="Chat is open because each of you privately chose it. Neither of you saw the other's answer first, and there is no rush."
          />
          {!!them?.verified && <Badge label="Identity verified" tone="success" />}
          <Card>
            <Text style={s.h2}>Start the conversation</Text>
            <Text style={s.note}>
              Say hello in your own words. If you'd like a hand, the assistant offers drafts you can edit; nothing is
              sent until you send it.
            </Text>
            {!!intro.conversation_id && (
              <Button onPress={() => router.push(`/messages/${intro.conversation_id}` as never)}>
                Start the conversation
              </Button>
            )}
          </Card>
          <Card>
            <Text style={s.h2}>Or plan a date</Text>
            <Text style={s.note}>
              Skip the small talk if you both prefer: a public place and a time that works for each of you.
            </Text>
            {!!intro.conversation_id && (
              <Button
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: "/dates/new", params: { conversation: intro.conversation_id } } as never)
                }
              >
                Plan a date
              </Button>
            )}
          </Card>
          {!intro.conversation_id && (
            <StatusBanner
              tone="caution"
              title="The conversation is being opened"
              body="Pull to refresh in a moment if the buttons above haven't appeared yet."
            />
          )}
          <Text style={s.fine}>
            Report and block are available inside the conversation at any time, and using them is never announced.
          </Text>
        </>
      )}
    </Screen>
  );
}

const s = {
  h2: { ...typo.title, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.lg },
} as const;
