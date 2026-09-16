"use client";

import { useEffect, useState } from "react";
import { ApiError, patch } from "@/lib/api";
import { useAuth, useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, ErrorState, Field, PageTitle, Select, Skeleton, TextInput, Toggle } from "@/components/ui";
import { LANG_LABEL } from "@/lib/format";
import type { Me } from "@/lib/types";
import { DEFAULT_PREFS, applyPrefs, loadPrefs, savePrefs, type Prefs } from "./prefs";

const TIMEZONES = ["Europe/Rome", "Europe/Madrid", "Europe/Lisbon", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Dublin", "Atlantic/Canary", "UTC"];

/** Y07 Language, alerts & accessibility. Locale and time zone live on the account; the rest are per-device conveniences. */
export default function SettingsPage() {
  const { me } = useRequireMember();
  const { refresh } = useAuth();
  const [locale, setLocale] = useState("");
  const [tz, setTz] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loadedPrefs, setLoadedPrefs] = useState(false);

  useEffect(() => {
    if (me && !locale) {
      setLocale(me.locale);
      setTz(me.timezone);
    }
  }, [me, locale]);
  useEffect(() => {
    const p = loadPrefs();
    setPrefs(p);
    applyPrefs(p);
    setLoadedPrefs(true);
  }, []);

  // Reversible, per-device: apply optimistically.
  const update = (next: Prefs) => {
    setPrefs(next);
    savePrefs(next);
  };

  const saveAccount = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await patch<Me>("/me", { locale, timezone: tz });
      await refresh();
      setSaved(true);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const tzOptions = tz && !TIMEZONES.includes(tz) ? [tz, ...TIMEZONES] : TIMEZONES;
  return (
    <AppShell>
      <PageTitle eyebrow="You · Settings" title="Language, alerts and accessibility" lede="Set a comfortable experience. Nothing here relies on colour alone, and safety alerts can't be silenced." />
      {!me ? (
        <Skeleton lines={5} />
      ) : (
        <>
          <ErrorState error={error} />
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Language and time zone</h2>
            <Field label="App language" htmlFor="locale" help="Translation in conversations is offered for EN, IT, ES and PT.">
              <Select id="locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
                {(["en", "it", "es", "pt"] as const).map((l) => (
                  <option key={l} value={l}>
                    {LANG_LABEL[l]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Time zone" htmlFor="tz" help="Dates and check-ins are shown in this zone.">
              <Select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                {tzOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
            <Button loading={busy} onClick={saveAccount}>
              {saved ? "Saved ✓" : "Save language and time zone"}
            </Button>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Notifications</h2>
            <p className="mb-2 text-sm text-ink-secondary">Grouped by what they're about. Deadlines reflect real reciprocal inventory; there is no manufactured urgency.</p>
            <Toggle checked={prefs.notify.introductions} onChange={(v) => update({ ...prefs, notify: { ...prefs.notify, introductions: v } })} label="Introductions" description="A new introduction or a mutual acceptance." />
            <Toggle checked={prefs.notify.conversations} onChange={(v) => update({ ...prefs, notify: { ...prefs.notify, conversations: v } })} label="Conversations" description="New messages." />
            <Toggle checked={prefs.notify.dates} onChange={(v) => update({ ...prefs, notify: { ...prefs.notify, dates: v } })} label="Dates" description="Proposals, confirmations, check-in reminders." />
            <Toggle checked={true} onChange={() => undefined} label="Safety (always on)" description="Report receipts, case updates and escalation acknowledgments cannot be turned off." />
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Quiet hours</h2>
            <Toggle checked={prefs.quietHours.enabled} onChange={(v) => update({ ...prefs, quietHours: { ...prefs.quietHours, enabled: v } })} label="Hold non-urgent alerts overnight" description="Safety alerts are still delivered." />
            {prefs.quietHours.enabled && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="qfrom">
                  <TextInput id="qfrom" type="time" value={prefs.quietHours.from} onChange={(e) => update({ ...prefs, quietHours: { ...prefs.quietHours, from: e.target.value } })} />
                </Field>
                <Field label="Until" htmlFor="qto">
                  <TextInput id="qto" type="time" value={prefs.quietHours.to} onChange={(e) => update({ ...prefs, quietHours: { ...prefs.quietHours, to: e.target.value } })} />
                </Field>
              </div>
            )}
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Text size</h2>
            <p className="mb-2 text-sm text-ink-secondary">Applies on this device right away. Layouts stack rather than clip.</p>
            <div role="radiogroup" aria-label="Text size" className="space-y-2">
              {(
                [
                  ["default", "Default", "16 px body text"],
                  ["large", "Large", "About 12% larger"],
                  ["xlarge", "Extra large", "About 30% larger"],
                ] as const
              ).map(([v, t, b]) => (
                <ChoiceCard key={v} title={t} body={b} selected={prefs.textSize === v} onSelect={() => update({ ...prefs, textSize: v })} />
              ))}
            </div>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Motion and contrast</h2>
            <Toggle checked={prefs.reducedMotion} onChange={(v) => update({ ...prefs, reducedMotion: v })} label="Reduce motion" description="Removes transitions and shimmer. Also follows your system setting automatically." />
            <Toggle checked={prefs.highContrast} onChange={(v) => update({ ...prefs, highContrast: v })} label="Higher contrast" description="Darker text and borders. States always carry text or a glyph, not colour alone." />
          </Card>
          {loadedPrefs && <p className="text-xs text-ink-tertiary">Device preferences are kept in this browser only and never sent to the matchmaker.</p>}
        </>
      )}
    </AppShell>
  );
}
