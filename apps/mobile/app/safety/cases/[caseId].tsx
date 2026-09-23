import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { CATEGORY_LABEL } from "@/components/safety";
import { Badge, Card, ErrorState, Loading, PageTitle, Screen } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

type CaseDetail = {
  id: string;
  category: string;
  state: string;
  opened_at: string;
  acknowledgement_due_at?: string | null;
  updates: { at: string; text: string }[];
  protection_applied: string[];
};

/** S03 Case status: what we did, what happens next, without exposing the other person. */
export default function CaseDetailScreen() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const { caseId } = useLocalSearchParams<{ caseId: string }>();
  const q = useQuery({
    queryKey: ["safety-case", caseId],
    queryFn: () => get<CaseDetail>(`/safety/cases/${caseId}`),
    enabled: !!me && !!caseId,
  });

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading case" />
      </Screen>
    );

  return (
    <Screen>
      <ErrorState error={(q.error as ApiError) ?? null} retry={() => q.refetch()} />
      {!!q.data && (
        <>
          <PageTitle
            eyebrow="Your report"
            title={CATEGORY_LABEL[q.data.category]?.label ?? q.data.category}
            lede={`Opened ${new Date(q.data.opened_at).toLocaleString()}`}
          />
          <Card>
            <Badge label={q.data.state} tone="context" />
            {!!q.data.acknowledgement_due_at && (
              <Text style={s.meta}>
                A person acknowledges this by {new Date(q.data.acknowledgement_due_at).toLocaleString()}.
              </Text>
            )}
          </Card>
          {q.data.protection_applied.length > 0 && (
            <Card>
              <Text style={s.h2}>What we did straight away</Text>
              {q.data.protection_applied.map((p) => (
                <Text key={p} style={s.meta}>
                  • {p}
                </Text>
              ))}
            </Card>
          )}
          {q.data.updates.length > 0 && (
            <Card>
              <Text style={s.h2}>Updates</Text>
              {q.data.updates.map((u) => (
                <Text key={u.at} style={s.meta}>
                  {new Date(u.at).toLocaleString()} — {u.text}
                </Text>
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 4 },
} as const;
