import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { Message } from "@/api/types";
import { Button, Card, ErrorState, Field, Options, PageTitle, Screen, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * M05 Translation.
 *
 * Either direction, and the translation is shown beside its source rather than replacing it:
 * a member should be able to see what was actually written, and what we made of it. The API
 * returns a confidence and a note, and both are shown — a translation presented as certain
 * when it is not is how a misunderstanding becomes a date nobody enjoyed.
 */
type Translated = {
  text: string;
  confidence: string;
  note?: string | null;
  source_lang: string;
  target_lang: string;
};
type History = { items: Message[] };

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "it", label: "Italiano" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
];

export default function Translate() {
  const { me } = useRequireMember();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = conversationId ?? "";
  const router = useRouter();

  const [source, setSource] = useState("it");
  const [target, setTarget] = useState(me?.locale ?? "en");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Message | null>(null);
  const [result, setResult] = useState<Translated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const history = useQuery({
    queryKey: ["messages", id],
    queryFn: () => get<History>(`/conversations/${id}/messages`),
    enabled: !!me && !!id,
  });
  // The last few messages from the other person are what a member usually wants translated.
  const theirs = (history.data?.items ?? []).filter((m) => !m.mine).slice(-3).reverse();

  const paywalled = error?.code === "FORBIDDEN";
  const unavailable = error?.code === "AI_UNAVAILABLE";

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await post<Translated>(`/conversations/${id}/translations`, {
          message_id: picked?.id ?? null,
          text: picked ? null : text.trim() || null,
          source_lang: source,
          target_lang: target,
        }),
      );
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle
        eyebrow="Translate"
        title="Read it in your language"
        lede="The original stays visible. Translations carry a confidence, because a confident wrong translation is worse than an uncertain one."
      />

      {paywalled && (
        <StatusBanner
          tone="context"
          title="Translation is part of Matchmaker Pro"
          body="Messaging in your own language is always free. Membership is managed on the web for now."
        />
      )}
      {unavailable && (
        <StatusBanner
          tone="caution"
          title="Translation is unavailable right now"
          body="You can still send your message in its original language."
        />
      )}
      {!paywalled && !unavailable && <ErrorState error={error} />}

      {!paywalled && (
        <>
          {!!theirs.length && (
            <Card>
              <Text style={s.h2}>Something they sent</Text>
              <Options
                value={picked?.id ?? ""}
                options={[
                  { value: "", label: "Type something instead" },
                  ...theirs.map((m) => ({ value: m.id, label: m.text.slice(0, 80) })),
                ]}
                onChange={(v) => {
                  setPicked(theirs.find((m) => m.id === v) ?? null);
                  setResult(null);
                }}
              />
            </Card>
          )}

          {!picked && (
            <Card>
              <Field label="Text to translate">
                <TextInput value={text} onChangeText={setText} multiline numberOfLines={4} maxLength={2000} />
              </Field>
            </Card>
          )}

          <Card>
            <Text style={s.h2}>From</Text>
            <Options value={source} options={LANGUAGES} onChange={setSource} />
            <Text style={s.h2}>To</Text>
            <Options value={target} options={LANGUAGES} onChange={setTarget} />
          </Card>

          <Button disabled={!picked && !text.trim()} loading={busy} onPress={run}>
            Translate
          </Button>

          {!!result && (
            <Card>
              <Text style={s.h2}>Translation</Text>
              <Text style={s.body}>{result.text}</Text>
              <Text style={s.meta}>
                Confidence: {result.confidence}
                {result.note ? ` · ${result.note}` : ""}
              </Text>
              <Text style={s.h2}>Original</Text>
              <Text style={s.body}>{picked?.text ?? text}</Text>
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
  h2: { ...typo.heading, color: color.ink, marginTop: space.md, marginBottom: space.xs },
  body: { ...typo.body, color: color.ink },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: space.xs, marginBottom: space.sm },
} as const;
