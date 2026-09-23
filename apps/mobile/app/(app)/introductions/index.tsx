import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { Introduction } from "@/api/types";
import { INTRO_STATUS_LABEL, type IntroductionList } from "@/components/intro";
import { Badge, Card, Empty, ErrorState, Loading, PageTitle, Screen } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

function IntroRow({ intro, onPress }: { intro: Introduction; onPress: () => void }) {
  const p = intro.profile;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card>
        <View style={s.row}>
          <Text style={s.name}>
            {p?.display_name ?? "An introduction"}
            {p?.age ? `, ${p.age}` : ""}
          </Text>
          {!!p?.verified && <Badge label="Verified" tone="success" />}
        </View>
        {!!p?.city && (
          <Text style={s.meta}>
            {p.city}
            {p.distance_band_km ? ` · ${p.distance_band_km}` : ""}
          </Text>
        )}
        <Text style={s.status}>{INTRO_STATUS_LABEL[intro.status] ?? intro.status}</Text>
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
    queryFn: () => get<IntroductionList>("/introductions"),
    enabled: !!me,
  });

  const open = (id: string) => router.push(`/introductions/${id}` as never);

  return (
    <Screen>
      <PageTitle
        eyebrow="Introductions"
        title="Who the matchmaker chose, and why"
        lede="A few explained, reciprocal introductions at a time. No stack, no likes, no rankings."
      />
      {q.isLoading && <Loading label="Loading introductions" />}
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      {!!q.data && (
        <>
          {q.data.current.length > 0 ? (
            <>
              <Text style={s.section}>Waiting for your private decision</Text>
              {q.data.current.map((i) => (
                <IntroRow key={i.id} intro={i} onPress={() => open(i.id)} />
              ))}
            </>
          ) : (
            !!q.data.waiting && (
              <Card>
                <Text style={s.sectionInline}>Why it's quiet</Text>
                <Text style={s.meta}>
                  {q.data.waiting.eligible_after_must} of {q.data.waiting.verified_pool} verified members clear your
                  Musts right now. Next batch {q.data.waiting.next_batch}.
                </Text>
                {q.data.waiting.reasons.map((r) => (
                  <Text key={r.code} style={s.reason}>
                    • {r.text}
                  </Text>
                ))}
                {!!q.data.waiting.protected_credits && (
                  <Text style={s.meta}>
                    {q.data.waiting.protected_credits} protected credit(s) held — a quiet week never costs you one.
                  </Text>
                )}
                <Text style={s.meta}>{q.data.waiting.broaden_hint}</Text>
              </Card>
            )
          )}

          {q.data.mutual.length > 0 && (
            <>
              <Text style={s.section}>You both said yes</Text>
              {q.data.mutual.map((i) => (
                <IntroRow key={i.id} intro={i} onPress={() => open(i.id)} />
              ))}
            </>
          )}

          {q.data.history.length > 0 && (
            <>
              <Text style={s.section}>Earlier</Text>
              {q.data.history.map((i) => (
                <IntroRow key={i.id} intro={i} onPress={() => open(i.id)} />
              ))}
            </>
          )}

          {!q.data.current.length && !q.data.mutual.length && !q.data.history.length && !q.data.waiting && (
            <Empty title="No introductions yet" body="The first batch arrives once your Blueprint and availability are in." />
          )}
        </>
      )}
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  status: { ...typo.caption, color: color.context, marginTop: space.sm },
  reason: { ...typo.small, color: color.inkSecondary, marginTop: space.xs },
  section: { ...typo.title, color: color.ink, marginTop: space.lg, marginBottom: space.sm },
  sectionInline: { ...typo.heading, color: color.ink, marginBottom: space.xs },
} as const;
