import { Redirect } from "expo-router";
import { useAuth, nextOnboardingPath } from "@/lib/auth";
import { Loading, Screen } from "@/components/ui";

/**
 * Entry gate. Sends a returning member straight to wherever they left off, so opening
 * the app never costs a tap to get back to the thing they came for.
 */
export default function Index() {
  const { me, loading } = useAuth();
  if (loading)
    return (
      <Screen scroll={false}>
        <Loading label="Opening Lovera" />
      </Screen>
    );
  if (!me) return <Redirect href="/welcome" />;
  return <Redirect href={nextOnboardingPath(me) as never} />;
}
