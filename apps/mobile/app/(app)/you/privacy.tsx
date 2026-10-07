import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { ApiError, get, post, put } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import { Badge, Button, Card, Divider, ErrorState, Loading, PageTitle, Screen, StatusBanner, Toggle } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * Y06 Consent and data.
 *
 * Onboarding asks for consent to process special-category data — who you are attracted to,
 * and optionally your faith. GDPR Art. 7(3) says withdrawing that has to be as easy as
 * giving it, and until this screen existed the app collected it with no way out, which is
 * a compliance gap rather than a missing feature.
 *
 * Terms, privacy and the community agreement cannot be revoked on their own, because an
 * account that has withdrawn from the terms is an account being closed. The API says so
 * too; rather than let a member hit that error, the switch is absent and the reason given.
 */
type Consents = { purposes: string[]; consents: Record<string, { status: string; policy_version: string; changed_at: string | null }> };
type PrivacyRequest = { id: string; type: string; status: string; requested_at: string; expires_at: string | null };
type Privacy = { requests: PrivacyRequest[]; matching_data: string[]; never_in_matching: string[] };

const COPY: Record<string, { label: string; body: string }> = {
  terms: { label: "Terms of Service", body: "Required to hold an account." },
  privacy: { label: "Privacy Notice", body: "Required to hold an account." },
  community: { label: "Community Agreement", body: "Required to hold an account." },
  ai_processing: {
    label: "AI help with matching and messages",
    body: "Lets us build your blueprint and offer draft replies and translation. Withdrawing keeps your account; matching falls back to the deterministic path and the draft and translate tools stop.",
  },
  special_category: {
    label: "Sexual orientation, and faith if you gave it",
    body: "Needed to match you with people you could actually be interested in. Withdrawing stops new introductions being made, because there is nothing left to match on.",
  },
  model_improvement: {
    label: "Help improve the matching model",
    body: "Optional, always. Nothing here affects who you are shown.",
  },
  marketing: { label: "Product emails", body: "Optional. Sign-in codes and safety messages are not marketing and always arrive." },
};
const REQUIRED = new Set(["terms", "privacy", "community"]);

export default function YouPrivacy() {
  const { me } = useRequireMember();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [requested, setRequested] = useState(false);

  const q = useQuery({ queryKey: ["consents"], queryFn: () => get<Consents>("/consents"), enabled: !!me });
  const privacy = useQuery({ queryKey: ["privacy"], queryFn: () => get<Privacy>("/me/privacy"), enabled: !!me });
  const [downloaded, setDownloaded] = useState<string | null>(null);

  const setConsent = async (purpose: string, granted: boolean) => {
    setBusy(purpose);
    setError(null);
    try {
      await put(`/consents/${purpose}`, { status: granted ? "granted" : "revoked" });
      // Withdrawing special-category consent changes two other payloads: `preferences` gains an
      // inactive row and loses faith from `available`, and `blueprint` marks that signal
      // uncorrectable. Both are cached and either may be mounted in the stack behind this screen,
      // so invalidating only `consents` left them contradicting the server — an active Must and a
      // live Change control on a criterion the matcher had just stopped applying.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["consents"] }),
        qc.invalidateQueries({ queryKey: ["preferences"] }),
        qc.invalidateQueries({ queryKey: ["blueprint"] }),
      ]);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading)
    return (
      <Screen scroll={false}>
        <Loading label="Loading your consents" />
      </Screen>
    );

  return (
    <Screen>
      <PageTitle
        eyebrow="You · Data"
        title="What you've agreed to"
        lede="Every one of these is yours to change. Withdrawing is as easy as giving, and we say plainly what stops working."
      />
      <ErrorState error={error ?? ((q.error as ApiError) ?? null)} retry={() => q.refetch()} />

      {(q.data?.purposes ?? []).map((purpose) => {
        const copy = COPY[purpose] ?? { label: purpose.replace(/_/g, " "), body: "" };
        const state = q.data?.consents[purpose];
        const granted = state?.status === "granted";
        return (
          <Card key={purpose}>
            <Text style={s.h2}>{copy.label}</Text>
            <Text style={s.meta}>{copy.body}</Text>
            {REQUIRED.has(purpose) ? (
              <>
                <Badge label={granted ? "Agreed" : "Not agreed"} tone={granted ? "success" : "muted"} />
                <Text style={s.fine}>
                  This one cannot be withdrawn by itself — withdrawing from the terms means closing the account, which
                  you can do below.
                </Text>
              </>
            ) : (
              <Toggle
                value={granted}
                onValueChange={(v) => void setConsent(purpose, v)}
                label={busy === purpose ? "Saving…" : granted ? "Granted" : "Not granted"}
              />
            )}
            {!!state?.changed_at && <Text style={s.fine}>Last changed {new Date(state.changed_at).toLocaleDateString()}</Text>}
          </Card>
        );
      })}

      <Divider />

      <Card>
        <Text style={s.h2}>Your data</Text>
        <Text style={s.meta}>
          A copy of everything we hold about you, including the blueprint we built and why you were introduced to
          whom. We email you when it is ready.
        </Text>
        {requested && <StatusBanner tone="context" title="Requested. We'll email you when the copy is ready." />}
        <Button
          variant="secondary"
          loading={busy === "export"}
          onPress={async () => {
            setBusy("export");
            setError(null);
            try {
              await post("/me/export", {});
              setRequested(true);
              await privacy.refetch();
            } catch (e) {
              setError(e as ApiError);
            } finally {
              setBusy(null);
            }
          }}
        >
          Request a copy of my data
        </Button>

        {(privacy.data?.requests ?? [])
          .filter((r) => r.type === "export")
          .map((r) => {
            const expired = !!r.expires_at && new Date(r.expires_at) <= new Date();
            return (
              <View key={r.id}>
                <Text style={s.fine}>
                  Requested {new Date(r.requested_at).toLocaleDateString()} · {expired ? "expired" : r.status}
                  {r.expires_at && !expired ? ` · available until ${new Date(r.expires_at).toLocaleDateString()}` : ""}
                </Text>
                {r.status === "ready" && !expired && (
                  <Button
                    variant="ghost"
                    loading={busy === r.id}
                    onPress={async () => {
                      setBusy(r.id);
                      setError(null);
                      try {
                        // The export is JSON, not a file the OS can hand off, so it is
                        // fetched and shown rather than downloaded. A real file export
                        // arrives with the media service.
                        const data = await get<Record<string, unknown>>(`/me/export/${r.id}`);
                        setDownloaded(JSON.stringify(data, null, 2));
                      } catch (e) {
                        setError(e as ApiError);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Open this copy
                  </Button>
                )}
              </View>
            );
          })}

        {!!downloaded && (
          <>
            <Text style={s.h2}>Your data</Text>
            <Text style={s.mono} selectable>
              {downloaded.slice(0, 20000)}
            </Text>
            {downloaded.length > 20000 && (
              <Text style={s.fine}>Truncated here. The web app offers the whole file.</Text>
            )}
          </>
        )}
      </Card>
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  meta: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
  fine: { ...typo.small, color: color.inkTertiary, marginTop: space.xs },
  mono: { ...typo.small, color: color.inkSecondary, fontFamily: "monospace" as const, marginTop: space.sm },
} as const;
