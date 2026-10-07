import { useState } from "react";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { awaitingServer, serverDriven } from "@/lib/query";
import { Badge, Button, Card, Divider, ErrorState, Field, Loading, PageTitle, Screen, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * Shown when an account is restricted: what was decided, and the appeal.
 *
 * The previous version of this screen told the member "the appeal route is in the safety
 * centre", which was not true on mobile — there was no appeal anywhere in the app. An
 * adverse decision a member cannot contest is not a review, so this fetches the actual
 * decision notices and lets them write to a person.
 *
 * What is not shown is what triggered the review, because publishing that teaches people
 * how to work around it. The decision itself, its dates, whether a human or a system made
 * it, and the kinds of evidence considered are all shown, which is the part a member needs
 * in order to argue.
 */
type Action = {
  id: string;
  type: string;
  reason_category: string;
  notice: string;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  decision_source: string;
  appealable: boolean;
  appeal: { id: string; status: string; outcome: string | null; decided_at: string | null } | null;
  evidence_types: string[];
};
type Review = { status: string; actions: Action[]; rights: string[] };

export default function AccountReview() {
  const { me, signOut } = useAuth();
  const router = useRouter();
  const [appealing, setAppealing] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["account-review"], queryFn: () => get<Review>("/account/review"), enabled: !!me, ...serverDriven });

  const submit = async (actionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await post(`/account/review/${actionId}/appeal`, { statement: statement.trim() });
      setSent(actionId);
      setAppealing(null);
      setStatement("");
      await q.refetch();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle eyebrow="Account" title="Decisions about your account" />
      <StatusBanner
        tone="caution"
        title="Introductions are paused while a person looks at this"
        body="You can still reach the safety centre and your own data."
      />
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />
      {awaitingServer(q) && <Loading label="Loading the decision" />}

      {q.data?.actions.length === 0 && (
        <Card>
          <Text style={s.body}>
            There is no decision notice on your account. If introductions are paused, a review is in progress and
            nothing has been decided yet.
          </Text>
        </Card>
      )}

      {q.data?.actions.map((a) => (
        <Card key={a.id}>
          <Text style={s.h2}>{a.notice}</Text>
          <Badge label={a.active ? "In effect" : "Ended"} tone={a.active ? "caution" : "muted"} />
          <Text style={s.meta}>
            {a.type.replace(/_/g, " ")} · decided by {a.decision_source === "human" ? "a person" : a.decision_source}
            {a.starts_at ? ` · from ${new Date(a.starts_at).toLocaleDateString()}` : ""}
            {a.ends_at ? ` until ${new Date(a.ends_at).toLocaleDateString()}` : ""}
          </Text>
          <Text style={s.meta}>Considered: {a.evidence_types.join(", ")}.</Text>

          {!!a.appeal && (
            <StatusBanner
              tone="context"
              title={`Your appeal is ${a.appeal.status}`}
              body={
                a.appeal.outcome
                  ? `Outcome: ${a.appeal.outcome}.`
                  : "A person reads every appeal. We aim to acknowledge within 24 hours."
              }
            />
          )}
          {sent === a.id && !a.appeal && <StatusBanner tone="context" title="Appeal sent. A person will read it." />}

          {a.appealable && appealing !== a.id && (
            <Button variant="secondary" onPress={() => setAppealing(a.id)}>
              Appeal this decision
            </Button>
          )}
          {appealing === a.id && (
            <>
              <Field
                label="What should the reviewer know?"
                help="A person reads this. Ten characters minimum; take the space you need."
              >
                <TextInput value={statement} onChangeText={setStatement} multiline numberOfLines={5} maxLength={4000} />
              </Field>
              <Button disabled={statement.trim().length < 10} loading={busy} onPress={() => submit(a.id)}>
                Send my appeal
              </Button>
              <Button variant="ghost" onPress={() => setAppealing(null)}>
                Cancel
              </Button>
            </>
          )}
          {!a.appealable && !a.appeal && <Text style={s.fine}>This decision is not appealable.</Text>}
        </Card>
      ))}

      {!!q.data?.rights.length && (
        <Card>
          <Text style={s.h2}>What you are entitled to</Text>
          {q.data.rights.map((r) => (
            <Text key={r} style={s.fine}>
              • {r}
            </Text>
          ))}
        </Card>
      )}

      <Card>
        <Text style={s.body}>
          We do not share what triggered a review, because doing so would tell people how to work around it. Everything
          above is what the reviewer saw about the decision itself.
        </Text>
      </Card>

      <Divider />
      <Button variant="secondary" onPress={() => router.push("/safety" as never)}>
        Safety centre
      </Button>
      <Button variant="ghost" onPress={() => void signOut().then(() => router.replace("/welcome"))}>
        {me?.email ? `Sign out (${me.email})` : "Sign out"}
      </Button>
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  body: { ...typo.body, color: color.inkSecondary },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: space.xs },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: 2 },
} as const;
