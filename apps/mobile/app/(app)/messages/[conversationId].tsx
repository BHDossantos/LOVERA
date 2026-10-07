import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, get, newIdempotencyKey, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { ConversationSummary, Message } from "@/api/types";
import { Badge, Button, ErrorState, Loading, StatusBanner, TextInput } from "@/components/ui";
import { color, radius, space, type as typo } from "@/theme";

type History = { items: Message[]; next_cursor: string | null; has_more: boolean };
type Pending = { client_message_id: string; text: string; state: "sending" | "failed"; error?: string };

function mergeMessages(a: Message[], b: Message[]) {
  const by = new Map(a.map((m) => [m.id, m]));
  b.forEach((m) => by.set(m.id, m));
  return [...by.values()].sort((x, y) => x.sequence - y.sequence);
}

/** M02 Conversation. Sends are keyed by client_message_id so a retry can never double-post. */
export default function Conversation() {
  const { me } = useRequireMember();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = conversationId ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const summary = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => get<ConversationSummary>(`/conversations/${id}`),
    enabled: !!me && !!id,
  });
  const history = useQuery({
    queryKey: ["messages", id],
    queryFn: () => get<History>(`/conversations/${id}/messages`),
    enabled: !!me && !!id,
    refetchInterval: 8_000,
  });

  const items = history.data?.items ?? [];
  const maxSeq = items.length ? items[items.length - 1].sequence : 0;

  // Marking read is a side effect of having seen the last message, not of opening the
  // screen: opening and immediately backing out should not clear someone's unread count.
  useEffect(() => {
    if (!id || !maxSeq) return;
    post(`/conversations/${id}/read`, { sequence: maxSeq }).catch(() => undefined);
  }, [id, maxSeq]);

  const send = useCallback(
    async (text: string, clientMessageId: string) => {
      setSendError(null);
      setPending((prev) => [
        ...prev.filter((x) => x.client_message_id !== clientMessageId),
        { client_message_id: clientMessageId, text, state: "sending" },
      ]);
      try {
        const msg = await post<Message>(`/conversations/${id}/messages`, {
          client_message_id: clientMessageId,
          text,
        });
        qc.setQueryData<History>(["messages", id], (old) =>
          old ? { ...old, items: mergeMessages(old.items, [msg]) } : { items: [msg], next_cursor: null, has_more: false },
        );
        setPending((prev) => prev.filter((x) => x.client_message_id !== clientMessageId));
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      } catch (e) {
        const err = e as ApiError;
        setSendError(err);
        if (err.code === "SAFETY_HOLD" || err.code === "CONFLICT")
          void qc.invalidateQueries({ queryKey: ["conversation", id] });
        setPending((prev) =>
          prev.map((x) =>
            x.client_message_id === clientMessageId ? { ...x, state: "failed", error: err.body.message } : x,
          ),
        );
      }
    },
    [id, qc],
  );

  const onSend = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void send(text, newIdempotencyKey());
  };

  if (summary.isLoading || (history.isLoading && !history.data))
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }}>
        <Loading label="Loading conversation" />
      </SafeAreaView>
    );

  const onHold = !!summary.data?.safety_hold;
  const ended = summary.data?.status === "ended" || summary.data?.status === "closed";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top", "left", "right"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Text style={s.back}>‹</Text>
        </Pressable>
        <Text style={s.headerName} numberOfLines={1}>
          {summary.data?.other.display_name ?? "Conversation"}
        </Text>
        {!!summary.data?.other.verified && <Badge label="Verified" tone="success" />}
        {!ended && (
          <Pressable
            onPress={() => router.push(`/messages/${id}/close` as never)}
            accessibilityRole="button"
            accessibilityLabel="End this conversation"
            hitSlop={12}
          >
            <Text style={s.headerAction}>End</Text>
          </Pressable>
        )}
      </View>

      {onHold && (
        <View style={{ paddingHorizontal: space.lg }}>
          <StatusBanner
            tone="caution"
            title="Messaging is paused during a safety review"
            body="Nobody is told who reported what. We'll update you here."
          />
        </View>
      )}
      {ended && !onHold && (
        <View style={{ paddingHorizontal: space.lg }}>
          <StatusBanner tone="context" title={summary.data?.public_reason ?? "This conversation has ended."} />
        </View>
      )}

      {/* Writing help, translation and leaving. Drafting is a paid capability and the
          assistant screen says so itself rather than this one guessing; translation is
          useful in a two-language city whichever plan you are on, so both are offered and
          the paywall is stated once, where it applies. */}
      {!onHold && !ended && (
        <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" onPress={() => router.push(`/messages/${id}/assistant` as never)}>
              Help me write
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" onPress={() => router.push(`/messages/${id}/translate` as never)}>
              Translate
            </Button>
          </View>
        </View>
      )}

      {/* The only route into the planner: a date belongs to a conversation, and the API
          creates at most one plan per conversation, so this either opens the existing plan
          or starts the first one. Hidden while a safety hold or an ending is in force. */}
      {!onHold && !ended && (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          {summary.data?.date ? (
            <Button variant="secondary" onPress={() => router.push(`/dates/${summary.data?.date?.date_plan_id}` as never)}>
              {summary.data.date.starts_at
                ? `Your date · ${new Date(summary.data.date.starts_at).toLocaleDateString()}`
                : "See the date you're planning"}
            </Button>
          ) : (
            <Button variant="secondary" onPress={() => router.push(`/dates/new?conversation=${id}` as never)}>
              Plan a date
            </Button>
          )}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.mine ? s.mine : s.theirs]}>
            <Text style={[s.bubbleText, item.mine && { color: "#fff" }]}>{item.text}</Text>
            {item.moderation_state === "held" && <Text style={s.moderation}>Held for review</Text>}
          </View>
        )}
        ListFooterComponent={
          <View>
            {pending.map((p) => (
              <View key={p.client_message_id} style={[s.bubble, s.mine, { opacity: 0.6 }]}>
                <Text style={[s.bubbleText, { color: "#fff" }]}>{p.text}</Text>
                <Text style={s.pendingState}>{p.state === "sending" ? "Sending…" : (p.error ?? "Didn't send")}</Text>
                {p.state === "failed" && (
                  <Pressable onPress={() => send(p.text, p.client_message_id)} accessibilityRole="button">
                    <Text style={s.retry}>Try again</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        }
      />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
        <View style={s.composer}>
          <ErrorState error={sendError} />
          {ended || onHold ? (
            <Text style={s.composerOff}>
              {onHold ? "Messaging is paused during the safety review." : "This conversation has ended."}
            </Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Write something real"
                  multiline
                  accessibilityLabel="Your message"
                  style={{ maxHeight: 120 }}
                />
              </View>
              <View style={{ width: 96 }}>
                <Button onPress={onSend} disabled={!draft.trim()}>
                  Send
                </Button>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = {
  headerAction: { ...typo.small, color: color.action, fontWeight: "600" as const, paddingLeft: space.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.surface,
  },
  back: { fontSize: 32, color: color.action, lineHeight: 34 },
  headerName: { ...typo.heading, color: color.ink, flex: 1 },
  bubble: { maxWidth: "82%", borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  mine: { alignSelf: "flex-end", backgroundColor: color.action },
  theirs: { alignSelf: "flex-start", backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  bubbleText: { ...typo.body, color: color.ink },
  moderation: { ...typo.caption, color: color.contextSoft, marginTop: 2 },
  pendingState: { ...typo.caption, color: "#ffffffcc", marginTop: 2 },
  retry: { ...typo.caption, color: "#fff", textDecorationLine: "underline", marginTop: 2 },
  composer: {
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  composerOff: { ...typo.small, color: color.inkTertiary, textAlign: "center" },
} as const;
