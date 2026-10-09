import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { serverDriven, useAwaitingServer } from "@/lib/query";
import type { Introduction } from "@/api/types";
import { INTRO_STATUS_LABEL, type IntroductionList } from "@/components/intro";
import { Avatar, AwaitingServer, Badge, Card, Empty, ErrorState, PageTitle, Screen } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * One introduction in the list, with a face on it.
 *
 * The detail screen deliberately puts the reasons *above* the photo, because that is where the
 * decision is made and leading a decision with a face is how you get people deciding on the face.
 * This is not that screen. Here the photo is identity — which of the three introductions am I
 * looking at — and a list of names with no faces at all is what made this app read as a directory
 * of strangers rather than as somewhere people are. The reason still rides along underneath.
 */
function IntroRow({ intro, onPress }: { intro: Introduction; onPress: () => void }) {
  const p = intro.profile;
  const name = p?.display_name ?? "An introduction";
  const photo = p?.media?.find((m) => m.type === "photo" && m.url)?.url ?? null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card>
        <View style={s.row}>
          <Avatar url={photo} name={name} verified={!!p?.verified} size={56} />
          <View style={s.rowBody}>
            <Text style={s.name}>
              {name}
              {p?.age ? `, ${p.age}` : ""}
            </Text>
            {!!p?.city && (
              <Text style={s.meta}>
                {p.city}
                {p.distance_band_km ? ` · ${p.distance_band_km}` : ""}
              </Text>
            )}
            <Text style={s.status}>{INTRO_STATUS_LABEL[intro.status] ?? intro.status}</Text>
          </View>
          {!!p?.verified && <Badge label="Verified" tone="success" />}
        </View>
        {!!intro.explanation?.reasons?.length && (
          <Text style={s.reason} numberOfLines={2}>
            {intro.explanation.reasons[0].text}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}

/** Introductions: the current reciprocal candidate, mutual yeses, and a quiet history. */
export default function IntroductionsScreen() {
  const { me } = useRequireMember();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["introductions"],
    ...serverDriven,
    queryFn: () => get<IntroductionList>("/introductions"),
    enabled: !!me,
  });
  /**
   * Null while the screen is still waiting on the server, so nothing stale renders.
   *
   * `awaitingServer` as an extra spinner was not enough: `gcTime: 0` cannot evict a query that
   * another mounted screen still observes, so the previous answer stayed on screen — and
   * actionable — underneath the loading indicator.
   */
  const awaiting = useAwaitingServer(q);
  const data = awaiting ? null : q.data;

  const open = (id: string) => router.push(`/introductions/${id}` as never);

  return (
    <Screen>
      <PageTitle
        eyebrow="Introductions"
        title="Who the matchmaker chose, and why"
        lede="A few explained, reciprocal introductions at a time. No stack, no likes, no rankings."
      />
      {/* Two different situations, so two renderings. Gated means there is nothing on screen, and
          `AwaitingServer` owns that: a spinner while it is working, then the error with a retry that
          is always offered. `ErrorState`'s own retry appears only for an error the API marked
          retryable — which an unexpected 500 is not — so leaving the gated case to it left a member
          with a sentence and nothing to press. Not gated means the list is up and a background poll
          failed, which is reported beside the data rather than in place of it. */}
      {awaiting ? (
        <AwaitingServer label="Loading introductions" query={q} />
      ) : (
        <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      )}
            {!!data && (
        <>
          {data.current.length > 0 ? (
            <>
              <Text style={s.section}>Waiting for your private decision</Text>
              {data.current.map((i) => (
                <IntroRow key={i.id} intro={i} onPress={() => open(i.id)} />
              ))}
            </>
          ) : (
            !!data.waiting && (
              <Card>
                <Text style={s.sectionInline}>Why it's quiet</Text>
                <Text style={s.meta}>
                  {data.waiting.eligible_after_must} of {data.waiting.verified_pool} verified members clear your
                  Musts right now. Next batch {data.waiting.next_batch}.
                </Text>
                {data.waiting.reasons.map((r) => (
                  <Text key={r.code} style={s.reason}>
                    • {r.text}
                  </Text>
                ))}
                {!!data.waiting.protected_credits && (
                  <Text style={s.meta}>
                    {data.waiting.protected_credits} protected credit(s) held — a quiet week never costs you one.
                  </Text>
                )}
                <Text style={s.meta}>{data.waiting.broaden_hint}</Text>
              </Card>
            )
          )}

          {data.mutual.length > 0 && (
            <>
              <Text style={s.section}>You both said yes</Text>
              {data.mutual.map((i) => (
                <IntroRow key={i.id} intro={i} onPress={() => open(i.id)} />
              ))}
            </>
          )}

          {data.history.length > 0 && (
            <>
              <Text style={s.section}>Earlier</Text>
              {data.history.map((i) => (
                <IntroRow key={i.id} intro={i} onPress={() => open(i.id)} />
              ))}
            </>
          )}

          {!data.current.length && !data.mutual.length && !data.history.length && !data.waiting && (
            <Empty title="No introductions yet" body="The first batch arrives once your Blueprint and availability are in." />
          )}
        </>
      )}
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  rowBody: { flex: 1 },
  name: { ...typo.heading, color: color.ink },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  status: { ...typo.caption, color: color.action, marginTop: space.xs },
  reason: { ...typo.small, color: color.inkSecondary, marginTop: space.md },
  section: { ...typo.title, color: color.ink, marginTop: space.lg, marginBottom: space.sm },
  sectionInline: { ...typo.heading, color: color.ink, marginBottom: space.xs },
} as const;
