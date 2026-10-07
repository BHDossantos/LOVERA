import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { serverDriven, useAwaitingServer } from "@/lib/query";
import { AwaitingServer, Button, Card, Divider, ErrorState, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

type Waiting = {
  eligible_after_must: number;
  verified_pool: number;
  capacity: number;
  reasons: { code: string; text: string }[];
  protected_credits: number;
  next_batch: string;
  broaden_hint: string;
};

/**
 * I06 Why nothing is waiting.
 *
 * The API already points members here: when there is nothing to do, Today returns a task
 * whose path is /introductions/waiting. On mobile that route did not exist, so the one
 * screen that explains an empty week was a dead tap. An app that offers nothing and will
 * not say why reads as broken or as withholding, and this product's whole claim is that
 * it explains itself.
 */
export default function Waiting() {
  const { me } = useRequireMember();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["introductions", "waiting"],
    queryFn: () => get<Waiting>("/introductions/waiting"),
    enabled: !!me,
    ...serverDriven,
  });

  const awaiting = useAwaitingServer(q);
  if (awaiting)
    return (
      <Screen scroll={false}>
        <AwaitingServer label="Checking why" query={q} />
      </Screen>
    );

  const d = q.data;
  return (
    <Screen>
      <PageTitle
        eyebrow="Introductions"
        title="Why there's nothing waiting"
        lede="Curation is weekly and deliberately small. An empty week is a real answer, not a gap."
      />
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      {!!d && (
        <>
          {d.reasons.map((r) => (
            <StatusBanner key={r.code} tone="context" title={r.text} />
          ))}

          <Card>
            <Text style={s.h2}>What the matchmaker is working with</Text>
            <Row label="Verified members in your pool" value={String(d.verified_pool)} />
            <Row label="Who pass both sides' Must criteria" value={String(d.eligible_after_must)} />
            <Row label="Introductions you can hold at once" value={String(d.capacity)} />
            {d.protected_credits > 0 && (
              <Row label="Protected credits" value={`${d.protected_credits} kept for you`} />
            )}
            <Divider />
            <Text style={s.note}>
              Your Must criteria are never quietly relaxed to fill a week. If the pool is thin, we say so instead.
            </Text>
          </Card>

          <Card>
            <Text style={s.h2}>If you want to widen the net</Text>
            <Text style={s.note}>{d.broaden_hint}</Text>
            <Button variant="secondary" onPress={() => router.push("/you/preferences" as never)}>
              Review my preferences
            </Button>
          </Card>
        </>
      )}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = {
  h2: { ...typo.title, color: color.ink, marginBottom: space.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: space.sm },
  rowLabel: { ...typo.body, color: color.inkSecondary, flex: 1, paddingRight: space.sm },
  rowValue: { ...typo.heading, color: color.ink },
  note: { ...typo.small, color: color.inkSecondary },
} as const;
