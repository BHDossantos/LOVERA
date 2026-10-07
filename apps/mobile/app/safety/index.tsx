import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Linking, Text } from "react-native";
import { ApiError, get } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { telUri, type SafetyCenter } from "@/components/safety";
import { BlockList } from "@/components/BlockList";
import { CaseList } from "@/components/CaseList";
import { Button, Card, Divider, ErrorState, Loading, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * S01 Safety centre. Reachable from every screen, and never more than one tap from a report.
 *
 * Three requests, because the API splits them that way: /safety carries the emergency
 * number, the guidance and two counts; the case list is /safety/cases and the block list is
 * /blocks. The previous version read all of it off /safety, which does not return it.
 *
 * The lists are components rather than inline markup because the API's own safety-centre
 * actions link to /safety/cases and /safety/blocks as pages in their own right.
 */
export default function SafetyCentre() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const router = useRouter();

  const centre = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetyCenter>("/safety"), enabled: !!me });
  const emergency = centre.data?.emergency;

  return (
    <Screen>
      <PageTitle
        eyebrow="Safety"
        title="Safety centre"
        lede="Report someone, block them, or check a case. Nothing you report is shown to the person you report."
      />
      <ErrorState error={(centre.error as ApiError) ?? null} retry={() => centre.refetch()} />

      {/* The emergency number comes first and does not depend on anything else loading. */}
      <StatusBanner
        tone="caution"
        title="In immediate danger, call emergency services"
        body={emergency?.note ?? "We are not an emergency service."}
      />
      <Button variant="danger" onPress={() => void Linking.openURL(telUri(emergency))}>
        {`Call ${emergency?.number ?? "112"}`}
      </Button>

      <Button onPress={() => router.push("/safety/report" as never)}>Report someone</Button>

      {centre.isLoading && <Loading label="Loading safety options" />}

      {!!centre.data?.education.length && (
        <Card>
          <Text style={s.section}>Worth knowing</Text>
          {centre.data.education.map((e) => (
            <Text key={e} style={s.edu}>
              • {e}
            </Text>
          ))}
        </Card>
      )}

      <Divider />
      <Text style={s.section}>Your cases</Text>
      <CaseList />

      <Divider />
      <Text style={s.section}>People you've blocked</Text>
      <BlockList onChanged={() => centre.refetch()} />
    </Screen>
  );
}

const s = {
  section: { ...typo.title, color: color.ink, marginTop: space.lg, marginBottom: space.sm },
  edu: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
} as const;
