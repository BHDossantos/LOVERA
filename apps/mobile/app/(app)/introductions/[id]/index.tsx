import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { ApiError, get, newIdempotencyKey, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { Introduction, Strength } from "@/api/types";
import { DECLINE_REASONS, INTRO_STATUS_LABEL, PROMPT_LABEL, type DecisionResult } from "@/components/intro";
import { CorrectionForm } from "@/components/CorrectionForm";
import {
  Badge,
  Button,
  Card,
  ChipGroup,
  Divider,
  ErrorState,
  Loading,
  Options,
  PageTitle,
  Screen,
  StatusBanner,
  Toggle,
} from "@/components/ui";
import { color, radius, space, type as typo } from "@/theme";

/** The explanation's three parts, in the order they are rendered. */
const SECTIONS = ["reasons", "friction", "unknown"] as const;

function strengthTone(s: Strength) {
  return s === "strong" ? "success" : s === "promising" ? "context" : "muted";
}

/**
 * I02-I04 in one screen. The phone has no room for a separate "why" page, and splitting
 * the reasons away from the decision is exactly how you get people deciding on the photo.
 * The explanation sits above the buttons and cannot be skipped past.
 */
export default function IntroductionDetail() {
  const { me } = useRequireMember();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["introduction", id],
    queryFn: () => get<Introduction>(`/introductions/${id}`),
    enabled: !!me && !!id,
    // Same hazard as the mutual screen, through the same cache key: this is reached from a
    // notification and from Today, and what it shows is a decision on a clock. A 15-second-old
    // cached status is enough to offer Accept on an introduction the server has since expired.
    staleTime: 0,
    refetchOnMount: "always",
  });

  const [choice, setChoice] = useState<"accept" | "decline" | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [extending, setExtending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const intro = q.data;

  /**
   * The API wants to know whether the member actually reached the explanation, not whether the
   * screen that contains it was opened — firing on mount would make this a synonym for
   * introduction_opened, which the API already records.
   *
   * Each of the three sections is measured separately, and only the ones whose top has come
   * into view are named. Measuring the card as a whole and then naming all three overstated it:
   * on a short screen the card's top reaching the fold says nothing about whether the friction
   * and the unknown, which sit below the reasons, were ever on screen.
   *
   * One request, sent once the member has stopped scrolling for a moment or has seen all three,
   * so `sections` describes what they actually read rather than what the screen contains. It is
   * fire-and-forget: nobody is shown an error because our analytics request failed.
   */
  const { height } = useWindowDimensions();
  const sectionTops = useRef<Record<string, number>>({});
  const cardTop = useRef(0);
  const scrollY = useRef(0);
  const reported = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seenSections = useCallback(() => {
    const fold = scrollY.current + height * 0.85;
    return Object.entries(sectionTops.current)
      .filter(([, y]) => cardTop.current + y <= fold)
      .map(([name]) => name)
      .sort();
  }, [height]);

  const send = useCallback(
    (sections: string[]) => {
      if (reported.current || !intro || !sections.length) return;
      reported.current = true;
      void post(`/introductions/${intro.id}/explanation-viewed`, { sections }).catch(() => {
        reported.current = false;
      });
    },
    [intro],
  );

  /** Wait for the scrolling to settle, unless every section has been measured and seen. */
  const considerReporting = useCallback(() => {
    if (reported.current || !intro?.explanation) return;
    const seen = seenSections();
    if (!seen.length) return;
    // Against SECTIONS, not against what has been measured so far: layouts arrive one at a
    // time, and "every section I have measured is visible" is true of the first one on its own.
    // That fired immediately with just ["reasons"] and then latched, so the two sections below
    // it could never be reported however far the member read.
    if (seen.length === SECTIONS.length) {
      send(seen);
      return;
    }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => send(seenSections()), 2_000);
  }, [intro, seenSections, send]);

  useEffect(() => () => void (idle.current && clearTimeout(idle.current)), []);

  const onExplanationLayout = (e: LayoutChangeEvent) => {
    cardTop.current = e.nativeEvent.layout.y;
    considerReporting();
  };

  /** `y` here is relative to the card, so it is added to the card's own offset. */
  const onSectionLayout = (name: string) => (e: LayoutChangeEvent) => {
    sectionTops.current = { ...sectionTops.current, [name]: e.nativeEvent.layout.y };
    considerReporting();
  };

  const submit = async () => {
    if (!intro || !choice) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<DecisionResult>(
        `/introductions/${intro.id}/decision`,
        {
          decision: choice,
          reason_codes: choice === "decline" && consent ? codes : [],
          learning_consent: consent,
        },
        { idempotencyKey, ifMatch: intro.version },
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["introduction", intro.id] }),
        qc.invalidateQueries({ queryKey: ["introductions"] }),
        qc.invalidateQueries({ queryKey: ["today"] }),
        qc.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
      if (r.conversation_id) router.replace(`/messages/${r.conversation_id}` as never);
      else router.back();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading introduction" />
      </Screen>
    );

  const p = intro?.profile;
  const ex = intro?.explanation;
  const photo = p?.media?.find((m) => m.type === "photo" && m.url)?.url ?? null;

  return (
    <Screen
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
        considerReporting();
      }}
    >
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />
      {!!intro && (
        <>
          <PageTitle
            eyebrow={INTRO_STATUS_LABEL[intro.status] ?? intro.status}
            title={`${p?.display_name ?? "An introduction"}${p?.age ? `, ${p.age}` : ""}`}
            lede={p?.city ? `${p.city}${p.distance_band_km ? ` · ${p.distance_band_km}` : ""}` : null}
          />
          {!!photo && (
            <Image
              source={{ uri: photo }}
              style={{ width: "100%", height: 380, borderRadius: radius.lg, marginBottom: space.md }}
              accessibilityLabel={`Photo of ${p?.display_name ?? "this person"}`}
              resizeMode="cover"
            />
          )}
          {!!p?.verified && <Badge label="Identity verified" tone="success" />}

          {/* The window is short on purpose, but a member who is simply away for a weekend
              should not lose an introduction to it. The extension is theirs to take without
              asking, and the other person is never told it happened. */}
          {!!intro.expires_at && (
            <Card>
              <Text style={s.h2}>You have until {new Date(intro.expires_at).toLocaleString()}</Text>
              <Text style={s.reasonText}>
                After that the introduction closes and neither of you is told what the other decided.
              </Text>
              {intro.actions.can_extend && (
                <Button
                  variant="secondary"
                  loading={extending}
                  onPress={async () => {
                    setExtending(true);
                    setError(null);
                    try {
                      await post(`/introductions/${intro.id}/extend`, {});
                      await qc.invalidateQueries({ queryKey: ["introduction", intro.id] });
                    } catch (e) {
                      setError(e as ApiError);
                    } finally {
                      setExtending(false);
                    }
                  }}
                >
                  Give me more time
                </Button>
              )}
            </Card>
          )}

          {!!ex && (
            <Card style={{ marginTop: space.md }} onLayout={onExplanationLayout}>
              <Text style={s.h2}>Why the matchmaker chose this</Text>
              {/* Each section measures itself, so "viewed" can mean this section rather than
                  the card that happens to contain it. */}
              <View onLayout={onSectionLayout("reasons")}>
                {ex.reasons.map((r) => (
                  <View key={r.label} style={{ marginBottom: space.md }}>
                    <View style={s.row}>
                      <Text style={s.reasonLabel}>{r.label}</Text>
                      <Badge label={r.strength.replace("_", " ")} tone={strengthTone(r.strength)} />
                    </View>
                    <Text style={s.reasonText}>{r.text}</Text>
                  </View>
                ))}
              </View>
              <Divider />
              <View onLayout={onSectionLayout("friction")}>
                <Text style={s.h3}>One honest friction</Text>
                <Text style={s.reasonText}>{ex.friction.text}</Text>
              </View>
              <View onLayout={onSectionLayout("unknown")}>
                <Text style={s.h3}>What only a date can tell you</Text>
                <Text style={s.reasonText}>{ex.unknown.text}</Text>
              </View>
              <Text style={s.fine}>
                Based on: {ex.data_categories.join(", ")}. No compatibility percentage is produced, because none
                would be honest.
              </Text>
            </Card>
          )}

          {!!ex && <CorrectionForm introId={intro.id} suggestedKeys={ex.unknown?.missing_signal_keys ?? []} />}

          {!!p?.bio && (
            <Card>
              <Text style={s.h2}>In their words</Text>
              <Text style={s.reasonText}>{p.bio}</Text>
              {p.prompts?.map((pr) => (
                <View key={pr.key} style={{ marginTop: space.md }}>
                  <Text style={s.h3}>{PROMPT_LABEL[pr.key] ?? pr.key}</Text>
                  <Text style={s.reasonText}>{pr.answer}</Text>
                </View>
              ))}
            </Card>
          )}

          {intro.actions.can_accept || intro.actions.can_decline ? (
            <Card>
              <Text style={s.h2}>Your decision is private</Text>
              <Text style={s.fine}>
                A pass is never shown to the other person. Chat opens only if you both say yes.
              </Text>
              <Options
                value={choice ?? ""}
                onChange={(v) => setChoice(v as "accept" | "decline")}
                options={[
                  { value: "accept", label: "Yes, I'd like to meet", body: "Opens a conversation only if they also said yes." },
                  { value: "decline", label: "Pass", body: "They are never told, and never shown this decision." },
                ]}
              />
              {choice === "decline" && (
                <>
                  <Toggle
                    value={consent}
                    onValueChange={setConsent}
                    label="Use my reason to improve my matches"
                    description="Optional. Your reason is never shown to the other person either way."
                  />
                  {consent && (
                    <View style={{ marginTop: space.md }}>
                      <ChipGroup
                        values={codes}
                        onChange={setCodes}
                        options={DECLINE_REASONS.map((r) => ({ value: r.code, label: r.label }))}
                      />
                    </View>
                  )}
                </>
              )}
              <Button onPress={submit} loading={busy} disabled={!choice}>
                {choice === "decline" ? "Pass on this introduction" : "Send my private yes"}
              </Button>
            </Card>
          ) : (
            <StatusBanner
              tone={intro.status === "mutual" ? "success" : "context"}
              title={INTRO_STATUS_LABEL[intro.status] ?? intro.status}
              body={
                intro.status === "awaiting_other_member"
                  ? "We'll tell you either way. Nothing is shown to them about your timing."
                  : undefined
              }
            />
          )}

          {intro.status === "mutual" && !!intro.conversation_id && (
            <Button onPress={() => router.replace(`/messages/${intro.conversation_id}` as never)}>
              Open the conversation
            </Button>
          )}
        </>
      )}
    </Screen>
  );
}

const s = {
  h2: { ...typo.title, color: color.ink, marginBottom: space.sm },
  h3: { ...typo.heading, color: color.ink, marginTop: space.md, marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  reasonLabel: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  reasonText: { ...typo.body, color: color.inkSecondary },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.md },
} as const;
