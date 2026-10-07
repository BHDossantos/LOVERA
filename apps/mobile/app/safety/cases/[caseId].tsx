import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { CASE_STATUS_LABEL, CATEGORY_LABEL, PROTECTION_LABEL, type SafetyCase } from "@/components/safety";
import { EvidenceAttach } from "@/components/EvidenceAttach";
import { Badge, Button, Card, Divider, ErrorState, Field, Loading, PageTitle, Screen, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * S03 Case status: what we did, what happens next, without exposing the other person.
 *
 * The fields are case_payload()'s: status, submitted_at, response_target, updates[].note.
 * An earlier version of this screen guessed at state/opened_at/updates[].text and so showed
 * "Opened Invalid Date", an empty badge and blank updates.
 */
export default function CaseDetailScreen() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const q = useQuery({
    queryKey: ["safety-case", caseId],
    queryFn: () => get<SafetyCase>(`/safety/cases/${caseId}`),
    enabled: !!me && !!caseId,
  });

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState<ApiError | null>(null);
  const [added, setAdded] = useState(false);

  const addNote = async () => {
    setBusy(true);
    setNoteError(null);
    try {
      await post(`/safety/cases/${caseId}/notes`, { note: note.trim() });
      setNote("");
      setAdded(true);
      await q.refetch();
    } catch (e) {
      setNoteError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading case" />
      </Screen>
    );

  const c = q.data;
  const closed = c?.status === "closed";

  return (
    <Screen>
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      {!!c && (
        <>
          <PageTitle
            eyebrow={`Case ${c.receipt_code}`}
            title={CATEGORY_LABEL[c.category]?.label ?? c.category}
            lede={`Submitted ${new Date(c.submitted_at).toLocaleString()}`}
          />
          <Card>
            <Badge label={CASE_STATUS_LABEL[c.status] ?? c.status} tone={closed ? "muted" : "context"} />
            <Text style={s.meta}>Response target: {c.response_target}.</Text>
            <Text style={s.meta}>
              {c.evidence_count === 0
                ? "Nothing attached yet."
                : c.evidence_count === 1
                  ? "1 item attached."
                  : `${c.evidence_count} items attached.`}
            </Text>
            {!!c.resolution_code && <Text style={s.meta}>Outcome: {c.resolution_code.replace(/_/g, " ")}.</Text>}
          </Card>
          {c.protection_applied.length > 0 && (
            <Card>
              <Text style={s.h2}>What we did straight away</Text>
              {c.protection_applied.map((p) => (
                <Text key={p} style={s.meta}>
                  • {PROTECTION_LABEL[p] ?? p.replace(/_/g, " ")}
                </Text>
              ))}
            </Card>
          )}
          {c.updates.length > 0 && (
            <Card>
              <Text style={s.h2}>Updates</Text>
              {c.updates.map((u) => (
                <Text key={u.at} style={s.meta}>
                  {new Date(u.at).toLocaleString()} — {u.note}
                </Text>
              ))}
            </Card>
          )}

          {closed ? (
            <>
              <Divider />
              <StatusBanner
                tone="context"
                title="This case is closed"
                body="Open a new report to add anything else. Your earlier report stays on record."
              />
            </>
          ) : (
            <>
              <Divider />
              {/* People remember things afterwards, and a case a member cannot add to is one
                  they have to re-report to correct. The reviewer sees this; the other person
                  never does. */}
              <Card>
                <Text style={s.h2}>Something else to add?</Text>
                <ErrorState error={noteError} />
                {added && <StatusBanner tone="context" title="Added. The reviewer will see it." />}
                <Field label="Anything you remembered since" help="Only you and the reviewer can see this.">
                  <TextInput value={note} onChangeText={setNote} multiline numberOfLines={4} maxLength={2000} />
                </Field>
                <Button disabled={!note.trim()} loading={busy} onPress={addNote}>
                  Add to the case
                </Button>
              </Card>
              <EvidenceAttach reportId={c.id} onAdded={() => q.refetch()} />
            </>
          )}

          <Text style={s.fine}>{c.support.note}</Text>
        </>
      )}
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 4 },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.lg },
} as const;
