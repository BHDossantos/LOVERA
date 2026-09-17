"use client";

import { use, useState } from "react";
import { ApiError, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, LinkButton, Skeleton, StatusBanner } from "@/components/ui";
import { ConversationHeader } from "@/components/messages/ConversationHeader";
import { useConversation } from "@/components/messages/useConversation";

type VoiceSession = { upload: { method: string; url: string; note: string }; max_seconds: number };
type VideoToken = { status: string; message: string; guidance: string[] };

/** M05 Voice/video readiness: optional ways to build confidence before meeting. Declining is never suspicious. */
export default function ReadinessPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId: id } = use(params);
  const { me } = useRequireMember();
  const summary = useConversation(me ? id : "");
  const conv = summary.data;
  const [voice, setVoice] = useState<VoiceSession | null>(null);
  const [video, setVideo] = useState<VideoToken | null>(null);
  const [busy, setBusy] = useState<"voice" | "video" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const call = async (kind: "voice" | "video") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "voice") setVoice(await post<VoiceSession>(`/conversations/${id}/voice-sessions`, { duration_seconds: 30 }));
      else setVideo(await post<VideoToken>(`/conversations/${id}/video-tokens`));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell>
      {summary.isLoading && <Skeleton lines={5} label="Loading" />}
      {summary.isError && <ErrorState error={summary.error as ApiError} retry={() => summary.refetch()} />}
      {conv && (
        <>
          <ConversationHeader conversation={conv} active="readiness" />
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">Some people like to hear a voice or see a face before meeting. Others prefer to go straight to a public first date. Both are normal, and nobody is told which you chose.</p>
            <ErrorState error={error} />
            <Card as="section" aria-labelledby="voice">
              <h2 id="voice" className="font-semibold text-ink">
                Voice note (up to 60 seconds)
              </h2>
              <p className="mt-1 text-sm text-ink-secondary">A short hello in your own voice. Recorded on your device; you choose whether to send it.</p>
              {voice ? (
                <StatusBanner type="info" title="How voice notes work in the pilot" body={<>{voice.upload.note} Maximum {voice.max_seconds} seconds. Nothing has been recorded or sent.</>} action={<LinkButton href={`/messages/${id}`} variant="secondary">Back to the conversation</LinkButton>} />
              ) : (
                <Button variant="secondary" className="mt-3" loading={busy === "voice"} disabled={busy !== null || conv.status !== "active"} onClick={() => call("voice")}>
                  Show me how voice notes work
                </Button>
              )}
            </Card>
            <Card as="section" aria-labelledby="video">
              <h2 id="video" className="font-semibold text-ink">
                Short video call
              </h2>
              <p className="mt-1 text-sm text-ink-secondary">No beauty filters by default. Recording without consent is against the community agreement.</p>
              {video ? (
                <StatusBanner type={video.status === "not_available_in_pilot" ? "caution" : "info"} title={video.status === "not_available_in_pilot" ? "Not available in the pilot yet" : "Video"} body={<>{video.message}{video.guidance.length > 0 && (<ul className="mt-2 list-disc pl-5">{video.guidance.map((g) => (<li key={g}>{g}</li>))}</ul>)}</>} />
              ) : (
                <Button variant="secondary" className="mt-3" loading={busy === "video"} disabled={busy !== null || conv.status !== "active"} onClick={() => call("video")}>
                  Check video availability
                </Button>
              )}
            </Card>
            <Card as="section" aria-labelledby="privacy-guidance">
              <h2 id="privacy-guidance" className="font-semibold text-ink">
                Privacy guidance
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-secondary">
                <li>Declining a call or voice note is never treated as suspicious, by us or in what the other member sees.</li>
                <li>Keep your surroundings neutral; avoid showing documents, addresses or house numbers.</li>
                <li>If anything feels off, end the call and use the shield in the header. Reports go to people, not matching.</li>
              </ul>
            </Card>
            <div className="flex flex-col gap-2 sm:flex-row">
              <LinkButton href={`/dates/new?conversation=${id}`} fullWidth>
                Skip ahead: plan a public date
              </LinkButton>
              <LinkButton href={`/messages/${id}`} variant="secondary" fullWidth>
                Back to the conversation
              </LinkButton>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
