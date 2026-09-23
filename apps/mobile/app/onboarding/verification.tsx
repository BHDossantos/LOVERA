import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ApiError, get, post } from "@/api/client";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { Button, Card, ErrorState, PageTitle, Screen, StatusBanner, Steps, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

type Status = { status: string; failure_reason_code?: string | null };
type Session = { session?: { hosted_url: string }; collects?: string[]; we_keep?: string[] };

const DEFAULT_COLLECTS = [
  "Government ID (checked by the vendor, not stored by us)",
  "Short liveness selfie (deleted by the vendor after the check)",
];
const DEFAULT_KEEP = [
  "A verified / not verified result",
  "Over-18 result",
  "A vendor reference token",
  "Verification date and expiry",
];

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ marginTop: space.sm }}>
      {items.map((c) => (
        <View key={c} style={{ flexDirection: "row", gap: space.sm, marginBottom: 4 }}>
          <Text style={{ color: color.inkTertiary }}>•</Text>
          <Text style={{ ...typo.small, color: color.inkSecondary, flex: 1 }}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

/** O03 Identity verification: why, what is collected, retention, alternate review path. */
export default function Verification() {
  useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  const status = useQuery({
    queryKey: ["verification"],
    queryFn: () => get<Status>("/verification/status"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (q) => (q.state.data?.status === "in_progress" ? 3000 : false),
  });
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState("");

  const redirected = useRef(false);
  const verified = status.data?.status === "verified";
  useEffect(() => {
    if (verified && !redirected.current) {
      redirected.current = true;
      void refresh().then((m) => m && router.replace(nextOnboardingPath(m) as never));
    }
  }, [verified, refresh, router]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await post<Session>("/verification/sessions");
      setSession(s);
      const url = s.session?.hosted_url;
      if (!url) return;
      // A real vendor hands back an absolute URL, which belongs in an in-app browser so
      // the member can see the address they are trusting with a passport photo. The
      // sandbox hands back one of our own routes, which we render natively.
      if (/^https?:\/\//i.test(url)) await WebBrowser.openBrowserAsync(url);
      else router.push({ pathname: "/onboarding/verification-vendor", params: { ref: url.split("ref=")[1] ?? "" } } as never);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const requestReview = async () => {
    setBusy(true);
    try {
      await post("/verification/review-request", { note });
      await status.refetch();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const s = status.data?.status ?? "not_started";
  return (
    <Screen>
      <Steps step={2} />
      <PageTitle
        eyebrow="Verification"
        title="Prove you're a real adult, once"
        lede="Everyone in the introduction pool has passed the same check. It keeps fakes and minors out; it is not a background check and not a guarantee of character."
      />
      <ErrorState error={error} />
      {s === "failed" && (
        <StatusBanner
          tone="caution"
          title="Automated verification didn't pass"
          body={`Reason code: ${status.data?.failure_reason_code ?? "unknown"}. You can retry or ask a human to review.`}
        />
      )}
      {s === "review_required" && (
        <StatusBanner
          tone="context"
          title="A human reviewer will look at your verification"
          body="Acknowledgment within 24 hours. You can keep setting up your profile meanwhile."
        />
      )}
      <Card>
        <Text style={{ ...typo.heading, color: color.ink }}>What the vendor checks</Text>
        <Bullets items={session?.collects ?? DEFAULT_COLLECTS} />
        <Text style={{ ...typo.heading, color: color.ink, marginTop: space.lg }}>What we keep</Text>
        <Bullets items={session?.we_keep ?? DEFAULT_KEEP} />
        <Text style={{ ...typo.small, color: color.inkTertiary, marginTop: space.md }}>
          Raw documents and biometrics never reach our servers and are never used for matching.
        </Text>
      </Card>
      {s !== "review_required" && (
        <Button onPress={start} loading={busy}>
          {s === "failed" ? "Try verification again" : "Begin identity and liveness verification"}
        </Button>
      )}
      {(s === "failed" || s === "in_progress") && (
        <Card>
          <Text style={{ ...typo.heading, color: color.ink, marginBottom: space.sm }}>Alternate path: human review</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Optional: what went wrong (lighting, document type…)"
            multiline
            numberOfLines={3}
            style={{ minHeight: 88, textAlignVertical: "top" }}
            accessibilityLabel="What went wrong"
          />
          <View style={{ marginTop: space.md }}>
            <Button variant="secondary" onPress={requestReview} loading={busy}>
              Ask a person to review
            </Button>
          </View>
        </Card>
      )}
    </Screen>
  );
}
