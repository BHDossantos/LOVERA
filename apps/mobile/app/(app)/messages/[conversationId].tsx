import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, get, newIdempotencyKey, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { awaitingServer, serverDriven } from "@/lib/query";
import type { ConversationSummary, Message } from "@/api/types";
import { AwaitingServer, Badge, Button, ErrorState, StatusBanner, TextInput } from "@/components/ui";
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
  const [blockError, setBlockError] = useState<ApiError | null>(null);
  const [blocking, setBlocking] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  // The summary carries the state the notifications are about — a new message, a conversation
  // closed, a safety hold — so it gets the full policy.
  const summary = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => get<ConversationSummary>(`/conversations/${id}`),
    enabled: !!me && !!id,
    ...serverDriven,
  });
  // The history deliberately does not. It refetches on mount, so a new-message notification
  // never opens a thread missing the message it was about, but it keeps its cache: `gcTime: 0`
  // would blank a conversation every time the member stepped out of it and back, and the 8s poll
  // already keeps it current. Showing the messages you had while the refetch lands is right for
  // a chat in a way it is not for a yes/no answer about somebody.
  const history = useQuery({
    queryKey: ["messages", id],
    queryFn: () => get<History>(`/conversations/${id}/messages`),
    enabled: !!me && !!id,
    refetchInterval: 8_000,
    refetchOnMount: "always",
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

  // The whole screen is the summary: the header, the banners, the safety row, the assistant, date
  // planning and the composer all read it. So it waits for the server rather than deriving a null
  // conversation and carrying on — a null one made `onHold` and `ended` both false, which is the
  // *permissive* reading of "I don't know yet": the composer, End and date planning stayed usable
  // on a conversation the server had closed or put on hold, and every message then came back
  // CONFLICT or SAFETY_HOLD. `summary.isLoading` is not the question either; it is false whenever
  // anything is cached, which is the whole point of this policy.
  if (awaitingServer(summary) || (history.isLoading && !history.data))
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }}>
        <AwaitingServer label="Loading conversation" query={summary} />
      </SafeAreaView>
    );

  const conversation = summary.data ?? null;
  const onHold = !!conversation?.safety_hold;
  const ended = conversation?.status === "ended" || conversation?.status === "closed";
  const them = conversation?.other;
  // Not `them.member_id`: that is null once the conversation is closed, which silently
  // disabled Block and dropped `subject` from the report on every ended thread.
  const subjectId = conversation?.safety.subject_id ?? null;
  const alreadyBlocked = !!conversation?.safety.blocked_by_you;

  /**
   * Blocking from inside the conversation, through POST /blocks.
   *
   * Until now the only way to block somebody was to file a report, or to answer a question on
   * the way out of the conversation — so a member who simply wanted contact to stop had to
   * accuse them of something first. Both stores expect block and report to be reachable from
   * the content itself (Apple guideline 1.2), and this screen had neither.
   */
  const block = () => {
    const memberId = subjectId;
    if (!memberId) return;
    Alert.alert(
      `Block ${them?.display_name ?? "them"}?`,
      "This ends the conversation and cancels any date you had planned. They are never told you blocked them — only that you are unavailable. You can undo it from the safety centre.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBlocking(true);
              setBlockError(null);
              try {
                await post("/blocks", { member_id: memberId });
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ["conversations"] }),
                  qc.invalidateQueries({ queryKey: ["blocks"] }),
                  qc.invalidateQueries({ queryKey: ["today"] }),
                ]);
                router.replace("/messages" as never);
              } catch (e) {
                setBlockError(e as ApiError);
              } finally {
                setBlocking(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top", "left", "right"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Text style={s.back}>‹</Text>
        </Pressable>
        <Text style={s.headerName} numberOfLines={1}>
          {conversation?.other.display_name ?? "Conversation"}
        </Text>
        {!!conversation?.other.verified && <Badge label="Verified" tone="success" />}
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
          <StatusBanner tone="context" title={conversation?.public_reason ?? "This conversation has ended."} />
        </View>
      )}

      {/* Report and block, from the conversation itself rather than three taps away in
          another tab — and the report carries the conversation and the person with it, so a
          reviewer gets the context instead of a bare narrative.

          Shown whatever the state, and that has to be true rather than merely intended: most
          reports are written after the thing is over, so an ended thread is exactly where
          this matters. Block is dropped once the member has blocked them, because a button
          that repeats an action already taken reads as if the first one did not work. */}
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <ErrorState error={blockError} retry={blockError ? () => block() : undefined} />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              variant="ghost"
              onPress={() =>
                router.push(`/safety/report?conversation=${id}${subjectId ? `&subject=${subjectId}` : ""}` as never)
              }
            >
              Report
            </Button>
          </View>
          {alreadyBlocked ? (
            <View style={{ flex: 1, justifyContent: "center" }}>
              <Text style={s.blocked}>Blocked. Undo it in the safety centre.</Text>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Button variant="ghost" loading={blocking} disabled={!subjectId} onPress={block}>
                Block
              </Button>
            </View>
          )}
        </View>
      </View>

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
          {conversation?.date ? (
            <Button variant="secondary" onPress={() => router.push(`/dates/${conversation?.date?.date_plan_id}` as never)}>
              {conversation.date.starts_at
                ? `Your date · ${new Date(conversation.date.starts_at).toLocaleDateString()}`
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
  blocked: { ...typo.small, color: color.inkSecondary, textAlign: "center" as const },
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
