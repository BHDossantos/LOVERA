import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, newIdempotencyKey, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { Button, Card, ErrorState, Field, Options, PageTitle, Screen, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * M03 AI Wingman.
 *
 * It drafts, the member sends. There is no auto-send and no silent send: the draft lands in
 * an editable field and the send is a separate, deliberate press, which is also what the API
 * insists on (`requires_member_review`, `can_auto_send: false`). The provenance line says
 * where the words came from, because a member should know which sentences are theirs.
 *
 * Drafting is a paid capability and manual messaging is always free, so a FORBIDDEN here is
 * not an error to apologise for — it is a fact to state once. There is no upgrade path in
 * the app yet, so this does not pretend to offer one.
 */
type Draft = {
  draft_id: string;
  text: string;
  requires_member_review: boolean;
  can_auto_send: boolean;
  provenance: string;
};

const GOALS = [
  { value: "respond", label: "Reply to them", body: "Pick up what they last said." },
  { value: "opener", label: "Open the conversation", body: "A first message that isn't 'hey'." },
  { value: "suggest_public_date", label: "Suggest meeting", body: "Propose a public place and a window." },
  { value: "reconnect", label: "Reconnect", body: "It has gone quiet and you'd like to try again." },
];
const TONES = [
  { value: "natural", label: "Natural" },
  { value: "warm", label: "Warm" },
  { value: "playful", label: "Playful" },
  { value: "direct", label: "Direct" },
];
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "it", label: "Italiano" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
];

export default function Assistant() {
  const { me } = useRequireMember();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = conversationId ?? "";
  const router = useRouter();
  const qc = useQueryClient();

  const [goal, setGoal] = useState("respond");
  const [tone, setTone] = useState("natural");
  const [language, setLanguage] = useState(me?.locale ?? "en");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // One client id per draft, so a retried send can never post the same message twice.
  const [clientId, setClientId] = useState(() => newIdempotencyKey());

  const paywalled = error?.code === "FORBIDDEN";
  const unavailable = error?.code === "AI_UNAVAILABLE";

  const generate = async () => {
    setBusy("draft");
    setError(null);
    try {
      const d = await post<Draft>(`/conversations/${id}/ai-drafts`, { mode: tone, goal, language });
      setDraft(d);
      setText(d.text);
      setClientId(newIdempotencyKey());
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!draft || !text.trim()) return;
    setBusy("send");
    setError(null);
    try {
      await post(`/conversations/${id}/messages`, {
        client_message_id: clientId,
        text: text.trim(),
        draft_id: draft.draft_id,
      });
      await qc.invalidateQueries({ queryKey: ["messages", id] });
      router.replace(`/messages/${id}` as never);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <PageTitle
        eyebrow="Writing assistant"
        title="A draft you can change"
        lede="It writes from your recent messages and their own prompt answers. It never invents experiences, and nothing is sent until you press send."
      />

      {paywalled && (
        <StatusBanner
          tone="context"
          title="Drafts and translation are part of Matchmaker Pro"
          body="Manual messaging is always free and nothing about your matching changes. Membership is managed on the web for now."
        />
      )}
      {unavailable && (
        <StatusBanner
          tone="caution"
          title="The assistant is unavailable right now"
          body="Your own words always work. Mention something specific from their prompts, then ask one open question."
        />
      )}
      {!paywalled && !unavailable && <ErrorState error={error} retry={draft ? undefined : generate} />}

      {!paywalled && (
        <>
          <Card>
            <Text style={s.h2}>What are you trying to do?</Text>
            <Options value={goal} options={GOALS} onChange={setGoal} />
          </Card>
          <Card>
            <Text style={s.h2}>Tone</Text>
            <Options value={tone} options={TONES} onChange={setTone} />
          </Card>
          <Card>
            <Text style={s.h2}>Language</Text>
            <Options value={language} options={LANGUAGES} onChange={setLanguage} />
          </Card>

          <Button loading={busy === "draft"} variant={draft ? "secondary" : "primary"} onPress={generate}>
            {draft ? "Draft another" : "Write me a draft"}
          </Button>

          {!!draft && (
            <Card>
              <Field label="Your message" help={draft.provenance}>
                <TextInput value={text} onChangeText={setText} multiline numberOfLines={6} />
              </Field>
              <Button disabled={!text.trim()} loading={busy === "send"} onPress={send}>
                Send this
              </Button>
            </Card>
          )}
        </>
      )}

      <Button variant="ghost" onPress={() => router.back()}>
        Back to the conversation
      </Button>
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
} as const;
