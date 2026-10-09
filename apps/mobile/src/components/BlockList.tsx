import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Text } from "react-native";
import { ApiError, del, get } from "@/api/client";
import type { Block } from "@/components/safety";
import { Button, Card, Empty, ErrorState, Loading } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * The block list and the unblock it needs, in one place.
 *
 * It lives here because two screens show it — the safety centre and /safety/blocks, which
 * is the path the API's own safety-centre actions point at — and a second copy of this
 * logic is a second copy of its mistakes.
 */
export function BlockList({ onChanged }: { onChanged?: () => void | Promise<unknown> }) {
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => get<{ items: Block[] }>("/blocks") });
  // Both are keyed by member, because rows other than the one spinning stay pressable and so
  // several unblocks really can be in flight at once. Anything held as a single value here is
  // stomped on by whichever request finishes last, and a lost failure is a block that silently
  // stayed — which is the bug this error handling exists for in the first place.
  const [unblocking, setUnblocking] = useState<string[]>([]);
  const [failures, setFailures] = useState<Record<string, ApiError>>({});

  const forget = (memberId: string) => setFailures(({ [memberId]: _cleared, ...rest }) => rest);

  const runUnblock = async (b: Block) => {
    setUnblocking((u) => [...u, b.member_id]);
    forget(b.member_id);
    try {
      await del(`/blocks/${b.member_id}`);
      forget(b.member_id);
      await Promise.all([blocks.refetch(), onChanged?.()]);
    } catch (e) {
      // An offline device used to leave this as an unhandled rejection: the block stayed,
      // nothing was said, and the member had no way to tell it had failed.
      setFailures((f) => ({ ...f, [b.member_id]: e as ApiError }));
    } finally {
      setUnblocking((u) => u.filter((id) => id !== b.member_id));
    }
  };

  const confirm = (b: Block) =>
    Alert.alert(
      `Unblock ${b.display_name}?`,
      "They are never told you blocked them, or that you stopped. A conversation that ended stays ended.",
      [
        { text: "Keep blocked", style: "cancel" },
        { text: "Unblock", onPress: () => void runUnblock(b) },
      ],
    );

  return (
    <>
      {blocks.isLoading && <Loading label="Loading your blocks" />}
      <ErrorState error={(blocks.error as ApiError) ?? null} retry={() => blocks.refetch()} />
      {blocks.data?.items.length === 0 && (
        <Empty title="Nobody blocked" body="Blocking is immediate and silent. They are never told." />
      )}
      {blocks.data?.items.map((b) => (
        <Card key={b.member_id}>
          <Text style={s.name}>{b.display_name}</Text>
          <Text style={s.meta}>Blocked {new Date(b.created_at).toLocaleDateString()}</Text>
          {/* A failure belongs in the row it happened to, not in a banner at the top. A banner
              has to pick one when several fail, and whichever it drops becomes a block that
              silently stayed. Here the message sits next to the person it is about and its
              retry cannot be ambiguous.

              The retry repeats the DELETE rather than reopening the confirmation: the member
              already said yes, and asking twice because our request failed is our problem to
              absorb, not theirs to re-answer. */}
          <ErrorState error={failures[b.member_id] ?? null} retry={() => void runUnblock(b)} />
          {/* A block you cannot lift is a decision made for you. */}
          <Button variant="ghost" loading={unblocking.includes(b.member_id)} onPress={() => confirm(b)}>
            Unblock
          </Button>
        </Card>
      ))}
    </>
  );
}

const s = {
  name: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
} as const;
