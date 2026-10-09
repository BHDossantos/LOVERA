import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Text, View, StyleSheet } from "react-native";
import { ApiError, post } from "@/api/client";
import { nextOnboardingPath, useAuth } from "@/lib/auth";
import { Button, Card, ErrorState, Field, Hero, Screen, TextInput } from "@/components/ui";
import { color, radius, space, type as typo } from "@/theme";

const PROMISES: [string, string][] = [
  ["Verified people only", "Identity and 18+ checks before anyone enters the pool. No swiping, no likes, no popularity score."],
  ["Private decisions", "Chat opens only after you both say yes. A pass is never shown to the other person."],
  ["Built around the second date", "We coordinate a safe public first date and learn from what you privately tell us afterwards."],
  ["AI assists, you speak", "Drafts and translations are suggestions. Nothing is sent as your words without you."],
];

/** O01 Welcome + sign-in. No profiles or pricing before the member understands the outcome and method. */
export default function Welcome() {
  const { me, loading, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<{ challenge_id: string; dev_code: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!loading && me) router.replace(nextOnboardingPath(me) as never);
  }, [me, loading, router]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await post<{ challenge_id: string; dev_code: string | null }>("/auth/start", { email: email.trim() });
      setChallenge(data);
      if (data.dev_code) setCode(data.dev_code);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const m = await signIn(challenge.challenge_id, code.trim());
      if (m) router.replace(nextOnboardingPath(m) as never);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {/* The first screen anybody sees. It used to be four ticked bullets above a form, on a flat
          cream background, with no image or colour anywhere in it — which is an honest description
          of the product and reads as a terms-of-service page. The words are unchanged; what they
          sit on is not. */}
      <Hero
        eyebrow="Invite-only pilot · Rome"
        title="A matchmaker, not a feed."
        lede="One to three verified, reciprocal introductions a week — each with three plain reasons it was made."
      />
      <View style={{ marginBottom: space.xl }}>
        {PROMISES.map(([t, b]) => (
          <View key={t} style={s.promise}>
            <View style={s.tickWell} accessibilityElementsHidden importantForAccessibility="no">
              <Text style={s.tick}>✓</Text>
            </View>
            <Text style={s.promiseText}>
              <Text style={{ fontWeight: "700" }}>{t}. </Text>
              <Text style={{ color: color.inkSecondary }}>{b}</Text>
            </Text>
          </View>
        ))}
      </View>
      <Card>
        <Text style={s.cardTitle}>Start your Dating Blueprint</Text>
        <Text style={s.cardBody}>
          Sign in with a one-time code. Verification and the Blueprint take about ten minutes.
        </Text>
        <ErrorState error={error} />
        {!challenge ? (
          <>
            <Field label="Email">
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                inputMode="email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                autoCorrect={false}
                onSubmitEditing={start}
                returnKeyType="send"
                accessibilityLabel="Email"
              />
            </Field>
            <Button onPress={start} loading={busy} disabled={!email.trim()}>
              Send me a code
            </Button>
          </>
        ) : (
          <>
            <Field label="Six-digit code" help={`We sent a code to ${email}. It expires in ten minutes.`}>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                inputMode="numeric"
                keyboardType="number-pad"
                // Lets iOS and Android offer the code straight from the notification.
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                onSubmitEditing={verify}
                returnKeyType="go"
                accessibilityLabel="Six-digit code"
              />
            </Field>
            <Button onPress={verify} loading={busy} disabled={code.trim().length < 6}>
              Continue
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                setChallenge(null);
                setCode("");
              }}
            >
              Use a different email
            </Button>
          </>
        )}
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  promise: { flexDirection: "row", gap: space.md, marginBottom: space.lg, alignItems: "flex-start" },
  tickWell: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: color.actionSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  tick: { ...typo.small, color: color.action, fontWeight: "700" },
  promiseText: { ...typo.body, color: color.ink, flex: 1, paddingTop: 3 },
  cardTitle: { ...typo.title, color: color.ink, marginBottom: space.xs },
  cardBody: { ...typo.small, color: color.inkSecondary, marginBottom: space.lg },
});
