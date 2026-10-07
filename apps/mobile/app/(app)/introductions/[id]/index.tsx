import { useCallback, useRef, useState } from "react";
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
   * The API wants to know whether the member actually reached the explanation, not whether
   * the screen that contains it was opened — that is the whole point of the signal, and
   * firing it on mount would make it a synonym for introduction_opened. So we report it once
   * the explanation has been scrolled into the viewport, which on a tall phone is often
   * immediately and on a short one is not.
   *
   * It is fire-and-forget: a member is never shown an error, and never blocked, because our
   * analytics request failed.
   */
  const { height } = useWindowDimensions();
  const explanationTop = useRef<number | null>(null);
  const scrollY = useRef(0);
  const reported = useRef(false);

  const reportViewed = useCallback(() => {
    const top = explanationTop.current;
    if (reported.current || top === null || !intro?.explanation) return;
    if (top > scrollY.current + height * 0.85) return;
    reported.current = true;
    const ex = intro.explanation;
    const sections = [
      ex.reasons.length ? "reasons" : null,
      ex.friction?.text ? "friction" : null,
      ex.unknown?.text ? "unknown" : null,
    ].filter((x): x is string => !!x);
    void post(`/introductions/${intro.id}/explanation-viewed`, { sections }).catch(() => {
      reported.current = false;
    });
  }, [height, intro]);

  const onExplanationLayout = (e: LayoutChangeEvent) => {
    explanationTop.current = e.nativeEvent.layout.y;
    reportViewed();
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
        reportViewed();
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
              {ex.reasons.map((r) => (
                <View key={r.label} style={{ marginBottom: space.md }}>
                  <View style={s.row}>
                    <Text style={s.reasonLabel}>{r.label}</Text>
                    <Badge label={r.strength.replace("_", " ")} tone={strengthTone(r.strength)} />
                  </View>
                  <Text style={s.reasonText}>{r.text}</Text>
                </View>
              ))}
              <Divider />
              <Text style={s.h3}>One honest friction</Text>
              <Text style={s.reasonText}>{ex.friction.text}</Text>
              <Text style={s.h3}>What only a date can tell you</Text>
              <Text style={s.reasonText}>{ex.unknown.text}</Text>
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
