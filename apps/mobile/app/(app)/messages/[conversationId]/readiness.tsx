import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { Button, Card, Divider, ErrorState, Loading, PageTitle, Screen, StatusBanner } from "@/components/ui";
import type { ConversationSummary } from "@/api/types";
import { color, space, type as typo } from "@/theme";

/**
 * M05 Voice and video readiness.
 *
 * Some people want to hear a voice before meeting a stranger in person; others would rather go
 * straight to a public first date. Both are ordinary, and the one thing this screen must never do
 * is make the second group look evasive — so declining is stated as normal, and the other member is
 * never told what was offered or refused.
 *
 * Voice and video are **pilot stubs in the API**: `/voice-sessions` describes how recording will
 * work and records nothing, and `/video-tokens` answers `not_available_in_pilot`. This screen shows
 * exactly that rather than a button that looks live, because a dating app that mimes a feature it
 * does not have is teaching members not to trust what it says. The privacy guidance below is real
 * and useful today, which is why the screen is worth having before the feature is.
 */
type VoiceSession = { upload: { method: string; url: string; note: string }; max_seconds: number };
type VideoToken = { status: string; message: string; guidance: string[] };

const GUIDANCE = [
  "Declining a call or a voice note is never treated as suspicious — not by us, and not in anything the other person sees.",
  "Keep what is behind you neutral. Avoid documents, addresses and house numbers.",
  "If anything feels off, end it and use the shield on the conversation. Reports reach people, never the matching engine.",
];

export default function Readiness() {
  const { me } = useRequireMember();
  const { conversationId: id } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => get<ConversationSummary>(`/conversations/${id}`),
    enabled: !!me && !!id,
  });
  const [voice, setVoice] = useState<VoiceSession | null>(null);
  const [video, setVideo] = useState<VideoToken | null>(null);
  const [busy, setBusy] = useState<"voice" | "video" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const conv = q.data;
  // A conversation on a safety hold, or one that has ended, is not a place to be arranging calls.
  const open = conv?.status === "active" && !conv?.safety_hold;

  const call = async (kind: "voice" | "video") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "voice") setVoice(await post<VoiceSession>(`/conversations/${id}/voice-sessions`, { duration_seconds: 30 }));
      else setVideo(await post<VideoToken>(`/conversations/${id}/video-tokens`));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <PageTitle
        eyebrow="Before you meet"
        title="Voice and video"
        lede="Some people like to hear a voice or see a face first. Others would rather go straight to a public first date. Both are normal, and nobody is told which you chose."
      />
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />
      {q.isLoading && <Loading label="Loading the conversation" />}

      {!!conv && (
        <>
          {!open && (
            <StatusBanner
              tone="context"
              title={conv.safety_hold ? "This conversation is on hold" : "This conversation has ended"}
              body="Calls and voice notes are not available here. The guidance below still applies to any date you have already planned."
            />
          )}

          <Card>
            <Text style={{ ...typo.heading, color: color.ink }}>Voice note</Text>
            <Text style={{ ...typo.small, color: color.inkSecondary, marginTop: 4 }}>
              A short hello in your own voice, recorded on your device. You choose whether to send it.
            </Text>
            {voice ? (
              <StatusBanner
                tone="context"
                title="How voice notes will work"
                body={`${voice.upload.note} Up to ${voice.max_seconds} seconds. Nothing has been recorded and nothing has been sent.`}
              />
            ) : (
              <View style={{ marginTop: space.md }}>
                <Button variant="secondary" loading={busy === "voice"} disabled={busy !== null || !open} onPress={() => call("voice")}>
                  Show me how voice notes work
                </Button>
              </View>
            )}
          </Card>

          <Card>
            <Text style={{ ...typo.heading, color: color.ink }}>Short video call</Text>
            <Text style={{ ...typo.small, color: color.inkSecondary, marginTop: 4 }}>
              No beauty filters by default. Recording anyone without their consent is against the community agreement.
            </Text>
            {video ? (
              <StatusBanner
                tone={video.status === "not_available_in_pilot" ? "caution" : "context"}
                title={video.status === "not_available_in_pilot" ? "Not available in the pilot yet" : "Video"}
                body={video.guidance.length > 0 ? `${video.message} ${video.guidance.join(" ")}` : video.message}
              />
            ) : (
              <View style={{ marginTop: space.md }}>
                <Button variant="secondary" loading={busy === "video"} disabled={busy !== null || !open} onPress={() => call("video")}>
                  Check video availability
                </Button>
              </View>
            )}
          </Card>

          <Card>
            <Text style={{ ...typo.heading, color: color.ink }}>Keeping yourself private</Text>
            <View style={{ marginTop: 4 }}>
              {GUIDANCE.map((g) => (
                <View key={g} style={{ flexDirection: "row", gap: space.sm, marginBottom: 6 }}>
                  <Text style={{ color: color.inkTertiary }} accessibilityElementsHidden importantForAccessibility="no">
                    ·
                  </Text>
                  <Text style={{ ...typo.small, color: color.inkSecondary, flex: 1 }}>{g}</Text>
                </View>
              ))}
            </View>
          </Card>

          <Divider />
          {open && (
            <Button onPress={() => router.push({ pathname: "/dates/new", params: { conversation: id } } as never)}>
              Skip ahead: plan a public date
            </Button>
          )}
          <Button variant="secondary" onPress={() => router.push(`/messages/${id}` as never)}>
            Back to the conversation
          </Button>
        </>
      )}
    </Screen>
  );
}
