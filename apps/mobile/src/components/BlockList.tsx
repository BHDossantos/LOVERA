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
  // Both are per-member, because rows other than the one spinning stay pressable and so two
  // unblocks really can be in flight at once. A single id and a split error/block pair let one
  // request stomp on the other's state: Ana succeeding cleared the block Ben's failure needed
  // for its retry, so Ben's error stayed on screen with no way to act on it.
  const [unblocking, setUnblocking] = useState<string[]>([]);
  const [failure, setFailure] = useState<{ block: Block; error: ApiError } | null>(null);

  const forgetFailure = (memberId: string) =>
    setFailure((f) => (f?.block.member_id === memberId ? null : f));

  const runUnblock = async (b: Block) => {
    setUnblocking((u) => [...u, b.member_id]);
    forgetFailure(b.member_id);
    try {
      await del(`/blocks/${b.member_id}`);
      forgetFailure(b.member_id);
      await Promise.all([blocks.refetch(), onChanged?.()]);
    } catch (e) {
      // An offline device used to leave this as an unhandled rejection: the block stayed,
      // nothing was said, and the member had no way to tell it had failed. The error and the
      // block it belongs to are set together so neither can outlive the other.
      setFailure({ block: b, error: e as ApiError });
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
      {/* The unblock error gets its own retry, because sharing the page's meant "Try again"
          refetched the list while the person stayed blocked and the message stayed on screen.
          The retry calls the unblock directly rather than reopening the confirmation: the
          member already said yes, and asking twice because our request failed is our problem
          to absorb, not theirs to re-answer. */}
      <ErrorState error={failure?.error ?? null} retry={failure ? () => void runUnblock(failure.block) : undefined} />
      {blocks.data?.items.length === 0 && (
        <Empty title="Nobody blocked" body="Blocking is immediate and silent. They are never told." />
      )}
      {blocks.data?.items.map((b) => (
        <Card key={b.member_id}>
          <Text style={s.name}>{b.display_name}</Text>
          <Text style={s.meta}>Blocked {new Date(b.created_at).toLocaleDateString()}</Text>
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
