import { useMemo, useState } from "react";
import { Text } from "react-native";
import { ApiError, patch } from "@/api/client";
import type { Me } from "@/api/types";
import { useAuth, useRequireMember } from "@/lib/auth";
import { Button, Card, ErrorState, Options, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * Y07 Language and time zone — the only member-facing field on `PATCH /me`, which mobile did
 * not call at all.
 *
 * Both values are captured once, at sign-up: the locale from the sign-in request and the time
 * zone from the city chosen on the intent step. Neither could be changed afterwards from the
 * app, so a member who moved — the thing this product is for, people who travel for somebody —
 * kept the zone of the city they left. That is not cosmetic: availability windows are weekday
 * and clock time, and the server reads them in the member's zone when it works out when two
 * people could actually meet, so a stale zone silently offers the wrong evenings.
 *
 * The web app has had this screen since launch (`apps/web/src/app/you/settings/page.tsx`); its
 * per-device accessibility preferences have no equivalent here because the OS owns them.
 */
const LOCALES = [
  { value: "en", label: "English", body: "Emails, notifications and the assistant." },
  { value: "it", label: "Italiano", body: "Email, notifiche e assistente." },
  { value: "es", label: "Español", body: "Correos, notificaciones y asistente." },
  { value: "pt", label: "Português", body: "Emails, notificações e assistente." },
];

/** The markets we run in, plus the zones members most often move between. */
const ZONES = [
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Dublin",
  "Atlantic/Canary",
  "UTC",
];

/**
 * The zone the phone is set to, which is almost always the answer.
 *
 * `Intl` is what `formatDateTime` already relies on, but `resolvedOptions()` is wrapped anyway:
 * a host that cannot answer should cost a member the suggestion, not the screen.
 */
function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The time it is right now in `zone`, so the choice is checkable rather than a guess. */
function nowIn(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date());
  } catch {
    return null;
  }
}

function zoneOption(value: string, note?: string) {
  const time = nowIn(value);
  return {
    value,
    label: value.split("/").pop()!.replace(/_/g, " "),
    body: [note, time ? `${time} there now` : null, value].filter(Boolean).join(" · "),
  };
}

export default function YouSettings() {
  const { me } = useRequireMember();
  const { refresh } = useAuth();
  // Held as an override rather than copied out of `me` on mount: initialising from a value that
  // is null on the first render is how a settings screen comes to post the default back over
  // whatever the member had.
  const [draft, setDraft] = useState<{ locale?: string; timezone?: string }>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const locale = draft.locale ?? me?.locale ?? "en";
  const timezone = draft.timezone ?? me?.timezone ?? "Europe/Rome";
  const dirty = !!me && (locale !== me.locale || timezone !== me.timezone);

  // Built from the account's stored zone rather than the selected one, so the list does not
  // reorder itself under the finger that is choosing from it.
  const zoneOptions = useMemo(() => {
    const device = deviceZone();
    const out: { value: string; label: string; body?: string }[] = [];
    const seen = new Set<string>();
    const add = (value: string | null | undefined, note?: string) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push(zoneOption(value, note));
    };
    add(device, "Your phone");
    add(me?.timezone, "Set on your account");
    for (const z of ZONES) add(z);
    return out;
  }, [me?.timezone]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await patch<Me>("/me", { locale, timezone });
      // `me` is what every screen reads, and the badge on this one included: refetch it rather
      // than trusting the response to be what the next screen will see.
      await refresh();
      setDraft({});
      setSaved(true);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle
        eyebrow="You · Settings"
        title="Language and time zone"
        lede="Both were taken from your phone and your city when you joined. Change them whenever either stops being true."
      />
      <ErrorState error={error} />
      {saved && !dirty && <StatusBanner tone="success" title="Saved" body="Your account uses these from now on." />}

      <Card>
        <Text style={s.h2}>Language</Text>
        <Text style={s.note}>
          What we write to you in. Conversations are never translated without you asking, and safety
          messages are sent in English as well so nothing important depends on a translation.
        </Text>
        <Options value={locale} options={LOCALES} onChange={(value) => setDraft((d) => ({ ...d, locale: value }))} />
      </Card>

      <Card>
        <Text style={s.h2}>Time zone</Text>
        <Text style={s.note}>
          Your weekly availability is read in this zone, so it decides which evenings we offer when we
          look for a time you and somebody else could both meet. Times already agreed keep the zone
          they were agreed in.
        </Text>
        <Options
          value={timezone}
          options={zoneOptions}
          onChange={(value) => setDraft((d) => ({ ...d, timezone: value }))}
        />
      </Card>

      <Button disabled={!dirty} loading={busy} onPress={save}>
        {dirty ? "Save" : "Nothing to save"}
      </Button>
      {dirty && (
        <Button variant="ghost" onPress={() => setDraft({})}>
          Keep what I had
        </Button>
      )}
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkSecondary, marginBottom: space.md },
} as const;
