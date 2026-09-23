import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Button, Card, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { Text } from "react-native";
import { color, type as typo } from "@/theme";

/** Shown when an account is restricted: what it means, and the one thing that can be done. */
export default function AccountReview() {
  const { me, signOut } = useAuth();
  const router = useRouter();
  return (
    <Screen>
      <PageTitle eyebrow="Account" title="Your account is under review" />
      <StatusBanner
        tone="caution"
        title="Introductions are paused while a person looks at this"
        body="You can still reach the safety centre and your own data."
      />
      <Card>
        <Text style={{ ...typo.body, color: color.inkSecondary }}>
          We do not share what triggered a review, because doing so would tell people how to work around it. If you
          think this is a mistake, the appeal route is in the safety centre and a human reads every one.
        </Text>
      </Card>
      <Button variant="secondary" onPress={() => router.push("/safety" as never)}>
        Safety centre
      </Button>
      <Button variant="ghost" onPress={() => void signOut().then(() => router.replace("/welcome"))}>
        {me?.email ? `Sign out (${me.email})` : "Sign out"}
      </Button>
    </Screen>
  );
}
