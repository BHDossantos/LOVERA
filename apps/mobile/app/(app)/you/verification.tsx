import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { ApiError, get, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, Divider, ErrorState, Loading, PageTitle, Screen, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * Y05 Verification centre.
 *
 * The You tab showed `verification_status` as a badge with nothing beside it to act on — the same
 * shape as the readiness dead end this app has already been fixed for twice. A member could read
 * "expired" on their own profile and had nowhere to go: the only verification screen on the phone
 * lived inside onboarding, so there was no way to see an expiry coming, read what a badge actually
 * claims, re-verify, or ask for a person once past signup.
 *
 * Expiry is not hypothetical — `verification_validity_days` is a real setting and
 * `verification_status` really returns "expired" — and when it happens `advance_onboarding` sends
 * the member back to the verification step. So the recovery path existed; what was missing was any
 * way to see it coming or to act before being pushed there.
 *
 * The limits sit beside every badge on purpose. "Identity checked" means a document matched a live
 * selfie at one moment in time. It is not a background check and not a claim about character, and a
 * dating app that lets members read it as one is doing them harm.
 */
type Badge_ = { key: string; label: string; limits: string };
type Status = {
  status: string;
  mode?: string;
  verified_at: string | null;
  expires_at: string | null;
  age_over_18: boolean | null;
  liveness_passed: boolean | null;
  failure_reason_code: string | null;
  badges: Badge_[];
};
type Session = { session?: { hosted_url: string } | null; mode?: string };

const MANUAL = "manual_review";
const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  verified: "Verified",
  failed: "Didn't pass",
  review_required: "Human review requested",
  expired: "Expired",
};
const THIRTY_DAYS = 30 * 86_400_000;

export default function VerificationCentre() {
  const { me } = useRequireMember();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["verification"],
    queryFn: () => get<Status>("/verification/status"),
    enabled: !!me,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState("");

  const s = q.data;
  const st = s?.status ?? "not_started";
  const manual = s?.mode === MANUAL;
  // A member who only learns about an expiry on the day it happens has already lost a week of
  // introductions. Thirty days is enough warning to act without it being nagging.
  const expiringSoon = st === "verified" && !!s?.expires_at && new Date(s.expires_at).getTime() - Date.now() < THIRTY_DAYS;

  const start = async () => {
    setBusy("start");
    setError(null);
    try {
      const out = await post<Session>("/verification/sessions");
      await q.refetch();
      const url = out.session?.hosted_url;
      if (!url) return; // manual_review hands back no session: the member is now in the queue.
      // A real vendor returns an absolute URL, which belongs in an in-app browser so the member can
      // see the address they are about to trust with a passport photo. The sandbox returns one of
      // our own routes, which is rendered natively.
      if (/^https?:\/\//i.test(url)) await WebBrowser.openBrowserAsync(url);
      else router.push({ pathname: "/onboarding/verification/vendor", params: { ref: url.split("ref=")[1] ?? "" } } as never);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const review = async () => {
    setBusy("review");
    setError(null);
    try {
      await post("/verification/review-request", { note });
      setNote("");
      await q.refetch();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const action = manual
    ? st === "verified"
      ? "Ask for a fresh check"
      : "Ask our team to verify you"
    : st === "verified"
      ? "Re-verify my identity"
      : st === "failed"
        ? "Try verification again"
        : st === "in_progress"
          ? "Continue verification"
          : "Begin identity and liveness verification";

  return (
    <Screen>
      <PageTitle
        eyebrow="You · Verification"
        title="Verification centre"
        lede="Verification keeps fakes and minors out of the pool. It is not a background check and never a guarantee of character; the limits sit beside every badge."
      />
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />
      {q.isLoading && <Loading label="Loading verification status" />}

      {!!s && (
        <>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
              <Text style={{ ...typo.heading, color: color.ink }}>Status</Text>
              <Badge label={STATUS_LABEL[st] ?? st} tone={st === "verified" ? "success" : st === "failed" || st === "expired" ? "caution" : "context"} />
            </View>
            <View style={{ marginTop: space.sm }}>
              {(
                [
                  ["Verified on", s.verified_at ? formatDate(s.verified_at) : "—"],
                  ["Expires", s.expires_at ? formatDate(s.expires_at) : "—"],
                  ["Over 18", s.age_over_18 === null ? "—" : s.age_over_18 ? "Confirmed" : "Not confirmed"],
                  ["Liveness", s.liveness_passed === null ? "—" : s.liveness_passed ? "Passed" : "Not passed"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md, paddingVertical: 6 }}>
                  <Text style={{ ...typo.small, color: color.inkSecondary }}>{k}</Text>
                  <Text style={{ ...typo.small, color: color.ink }}>{v}</Text>
                </View>
              ))}
            </View>
          </Card>

          {expiringSoon && (
            <StatusBanner
              tone="caution"
              title="Your verification expires soon"
              body="Re-verify to keep receiving introductions without a gap. Your conversations and safety tools are never affected."
            />
          )}
          {st === "expired" && (
            <StatusBanner
              tone="caution"
              title="Your verification has expired"
              body="Introductions pause until you re-verify. Conversations, dates and safety tools keep working."
            />
          )}
          {st === "failed" && (
            <StatusBanner
              tone="caution"
              title="Automated verification didn't pass"
              body={`Reason code: ${s.failure_reason_code ?? "unknown"}. You can try again, or ask a person to look at it.`}
            />
          )}
          {st === "review_required" && (
            <StatusBanner
              tone="context"
              title="A person will look at your verification"
              body="Acknowledgment within 24 hours. Your matching and your messages are never part of that review."
            />
          )}

          <Card>
            <Text style={{ ...typo.heading, color: color.ink }}>What each badge means</Text>
            {s.badges.length === 0 && (
              <Text style={{ ...typo.small, color: color.inkSecondary, marginTop: 4 }}>
                No badges yet. Once verified you carry “Identity checked” and “18+”, each with its limits stated.
              </Text>
            )}
            {s.badges.map((b) => (
              <View key={b.key} style={{ paddingVertical: space.sm }}>
                <Text style={{ ...typo.small, color: color.ink, fontWeight: "600" }}>✓ {b.label}</Text>
                <Text style={{ ...typo.small, color: color.inkSecondary }}>{b.limits}</Text>
              </View>
            ))}
            <Divider />
            <Text style={{ ...typo.small, color: color.inkTertiary }}>
              {manual
                ? "A member of our team does this check personally. We keep a result, an over-18 result, who decided it and the dates — no documents and no biometrics."
                : "Raw documents and biometrics stay with the vendor. We keep a result, an over-18 result, a reference token and the dates."}
            </Text>
          </Card>

          {st !== "review_required" && (
            <Button loading={busy === "start"} onPress={start}>
              {action}
            </Button>
          )}

          {(st === "failed" || st === "in_progress" || st === "expired") && (
            <Card>
              <Text style={{ ...typo.heading, color: color.ink, marginBottom: space.sm }}>Ask a person to review</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Optional: what went wrong (lighting, document type…)"
                multiline
                numberOfLines={3}
                style={{ minHeight: 88, textAlignVertical: "top" }}
                accessibilityLabel="Note for the reviewer"
              />
              <View style={{ marginTop: space.md }}>
                <Button variant="secondary" loading={busy === "review"} onPress={review}>
                  Request human review
                </Button>
              </View>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
