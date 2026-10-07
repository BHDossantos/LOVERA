import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { ApiError, get } from "@/api/client";
import { CASE_STATUS_LABEL, CATEGORY_LABEL, type SafetyCase } from "@/components/safety";
import { Badge, Card, Empty, ErrorState, Loading } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/** The member's own reports. Shown on the safety centre and on /safety/cases. */
export function CaseList() {
  const router = useRouter();
  const cases = useQuery({ queryKey: ["safety", "cases"], queryFn: () => get<{ items: SafetyCase[] }>("/safety/cases") });

  return (
    <>
      {cases.isLoading && <Loading label="Loading your cases" />}
      <ErrorState error={(cases.error as ApiError) ?? null} retry={() => cases.refetch()} />
      {cases.data?.items.length === 0 && (
        <Empty title="No cases" body="Anything you report shows up here with its status." />
      )}
      {cases.data?.items.map((c) => (
        <Pressable key={c.id} onPress={() => router.push(`/safety/cases/${c.id}` as never)} accessibilityRole="button">
          <Card>
            <View style={s.row}>
              <Text style={s.name}>{CATEGORY_LABEL[c.category]?.label ?? c.category}</Text>
              <Badge label={CASE_STATUS_LABEL[c.status] ?? c.status} tone="muted" />
            </View>
            <Text style={s.meta}>
              Receipt {c.receipt_code} · submitted {new Date(c.submitted_at).toLocaleDateString()}
            </Text>
          </Card>
        </Pressable>
      ))}
    </>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { ...typo.heading, color: color.ink, flex: 1, paddingRight: space.sm },
  meta: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
} as const;
