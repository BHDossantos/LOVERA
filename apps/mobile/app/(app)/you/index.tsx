import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ApiError, del, get, post } from "@/api/client";
import { useAuth, useRequireMember } from "@/lib/auth";
import { Badge, Button, Card, Divider, ErrorState, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

type Privacy = { paused: boolean; deletion_due_at: string | null };

/**
 * Y01 You. Also the screen both stores audit hardest: an app that collects a profile
 * must let a member delete the account from inside the app, in a path no deeper than
 * this one, without emailing anyone.
 */
export default function YouScreen() {
  const { me } = useRequireMember();
  const { signOut, refresh } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const privacy = useQuery({
    queryKey: ["privacy"],
    queryFn: () => get<Privacy>("/me/privacy"),
    enabled: !!me,
  });

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await Promise.all([privacy.refetch(), refresh()]);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete your account?",
      "Your profile, Blueprint and conversations are scheduled for deletion. You have a grace period to change your mind, after which this cannot be undone.",
      [
        { text: "Keep my account", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void run("delete", () => del("/me")),
        },
      ],
    );
  };

  const deleting = !!privacy.data?.deletion_due_at;
  const paused = !!privacy.data?.paused;

  return (
    <Screen>
      <PageTitle eyebrow="You" title={me?.email ?? "Your account"} lede="Your plan, your data, and the controls that are actually yours." />
      <ErrorState error={error} />

      {deleting && (
        <StatusBanner
          tone="caution"
          title="Your account is scheduled for deletion"
          body={`Due ${new Date(privacy.data!.deletion_due_at!).toLocaleDateString()}. You can still stop this.`}
        />
      )}
      {deleting && (
        <Button variant="secondary" loading={busy === "cancel"} onPress={() => run("cancel", () => post("/me/cancel-deletion"))}>
          Keep my account after all
        </Button>
      )}
      {paused && !deleting && (
        <StatusBanner
          tone="context"
          title="Your account is paused"
          body="No new introductions and your profile is hidden from new people. Conversations, dates and safety tools keep working."
        />
      )}

      <Card>
        <View style={s.row}>
          <Text style={s.label}>Plan</Text>
          <Badge label={me?.capabilities.entitlements.plan_name ?? "Free"} tone="muted" />
        </View>
        <View style={s.row}>
          <Text style={s.label}>Identity</Text>
          <Badge
            label={me?.verification_status === "verified" ? "Verified" : (me?.verification_status ?? "—")}
            tone={me?.verification_status === "verified" ? "success" : "context"}
          />
        </View>
        <View style={s.row}>
          <Text style={s.label}>Open to introductions</Text>
          <Badge label={me?.date_ready ? "Yes" : "Paused"} tone={me?.date_ready ? "success" : "muted"} />
        </View>
        {/* The badge used to be the end of it: a member whose readiness was off could read that
            it was off and do nothing about it, while Today kept asking them to fix it. */}
        {!me?.date_ready && (
          <Button variant="secondary" onPress={() => router.push("/you/availability" as never)}>
            Open myself to introductions again
          </Button>
        )}
      </Card>

      <Card>
        <Text style={s.h2}>Your profile and matching</Text>
        <Text style={s.note}>
          Photos, prompts and the things you will and won't compromise on. Changing a preference shows you what it
          costs before you save.
        </Text>
        <Button variant="secondary" onPress={() => router.push("/you/profile" as never)}>
          Edit my profile
        </Button>
        <Button variant="secondary" onPress={() => router.push("/you/preferences" as never)}>
          Preferences and dealbreakers
        </Button>
        <Button variant="secondary" onPress={() => router.push("/you/blueprint" as never)}>
          What we think we know about you
        </Button>
        <Button variant="secondary" onPress={() => router.push("/you/availability" as never)}>
          When you can meet, and readiness
        </Button>
      </Card>

      <Card>
        <Text style={s.h2}>Language and time zone</Text>
        <Text style={s.note}>
          Both were taken from your phone and your city when you joined. Your time zone decides which
          evenings we offer when we look for a time you and somebody else could both meet.
        </Text>
        <Button variant="secondary" onPress={() => router.push("/you/settings" as never)}>
          Language and time zone
        </Button>
      </Card>

      <Card>
        <Text style={s.h2}>Safety</Text>
        <Text style={s.note}>
          Report someone, block them, or review an open case. Reports are never shown to the person you report.
        </Text>
        <Button variant="secondary" onPress={() => router.push("/safety" as never)}>
          Safety centre
        </Button>
      </Card>

      <Card>
        <Text style={s.h2}>Your data</Text>
        <Text style={s.note}>
          What you've agreed to, and a copy of everything we hold. Every consent is yours to withdraw.
        </Text>
        <Button variant="secondary" onPress={() => router.push("/you/privacy" as never)}>
          Consents and data
        </Button>
        {!paused && !deleting && (
          <Button variant="ghost" loading={busy === "pause"} onPress={() => run("pause", () => post("/me/pause"))}>
            Pause introductions
          </Button>
        )}
        {paused && !deleting && (
          <Button variant="ghost" loading={busy === "resume"} onPress={() => run("resume", () => post("/me/resume"))}>
            Resume introductions
          </Button>
        )}
      </Card>

      <Divider />
      <Button variant="ghost" onPress={() => void signOut().then(() => router.replace("/welcome"))}>
        Sign out
      </Button>
      {!deleting && (
        <Button variant="danger" onPress={confirmDelete} loading={busy === "delete"}>
          Delete my account
        </Button>
      )}
      <Pressable onPress={() => router.push("/you/legal" as never)} accessibilityRole="link">
        <Text style={s.link}>Terms, Privacy Notice and Community Agreement</Text>
      </Pressable>
    </Screen>
  );
}

const s = {
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: space.sm },
  label: { ...typo.body, color: color.inkSecondary },
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkSecondary, marginBottom: space.md },
  link: { ...typo.small, color: color.action, textAlign: "center", marginTop: space.md },
} as const;
