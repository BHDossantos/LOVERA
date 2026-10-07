import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { Button, Card, ErrorState, Field, Options, PageTitle, Screen, StatusBanner, TextInput, Toggle } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * M06 Ending a conversation.
 *
 * Leaving should be as easy as arriving, and it should not require an explanation to the
 * other person. The reason is for us, never shown to them; the private note is for the
 * member's own record. Blocking is offered here because the moment someone decides to leave
 * is often the moment they want contact to stop, and making them find another screen for it
 * is a small cruelty.
 */
const REASONS = [
  { value: "not_for_me", label: "Not for me", body: "No further explanation needed." },
  { value: "timing", label: "Wrong timing" },
  { value: "met_someone", label: "I've met someone" },
  { value: "no_reply", label: "They stopped replying" },
  { value: "safety", label: "Something felt unsafe", body: "This routes to a person, and you can report separately." },
  { value: "other", label: "Another reason" },
];

export default function CloseConversation() {
  useRequireMember();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = conversationId ?? "";
  const router = useRouter();
  const qc = useQueryClient();

  const [reason, setReason] = useState("not_for_me");
  const [note, setNote] = useState("");
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/conversations/${id}/close`, {
        reason,
        private_note: note.trim() || null,
        block,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["conversations"] }),
        qc.invalidateQueries({ queryKey: ["conversation", id] }),
        qc.invalidateQueries({ queryKey: ["blocks"] }),
      ]);
      router.replace("/messages" as never);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle
        eyebrow="End this conversation"
        title="You don't owe anyone an explanation"
        lede="They are told the conversation ended, and nothing about why. Your reason and your note stay with us."
      />
      <ErrorState error={error} />

      <Card>
        <Text style={s.h2}>Why, for our records</Text>
        <Options value={reason} options={REASONS} onChange={setReason} />
      </Card>

      {reason === "safety" && (
        <StatusBanner
          tone="caution"
          title="A safety reason reaches a person"
          body="Ending the conversation is not a report. If you want it investigated, you can report from the Safety centre — reports are private either way."
        />
      )}

      <Card>
        <Field label="A private note (optional)" help="Only you and our safety team can see this. It is never shown to them.">
          <TextInput value={note} onChangeText={setNote} multiline numberOfLines={3} maxLength={300} />
        </Field>
        <Toggle
          value={block}
          onValueChange={setBlock}
          label="Block them as well — silent, and they are never told"
        />
      </Card>

      <Button variant="danger" loading={busy} onPress={submit}>
        End the conversation
      </Button>
      <Button variant="ghost" onPress={() => router.back()}>
        Keep it open
      </Button>
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
} as const;
