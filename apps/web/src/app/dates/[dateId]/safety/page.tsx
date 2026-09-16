"use client";

import { use, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, ErrorState, Field, LinkButton, PageTitle, Select, Skeleton, StatusBanner, TextInput } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useDatePlan } from "@/components/dates/shared";
import { EmergencyCard } from "@/components/safety/shared";
import type { DatePlan } from "@/lib/types";

const SCOPES = [
  { value: "plan", title: "The plan only", body: "Venue area, date and time. No check-in." },
  { value: "plan_and_checkin", title: "Plan and check-in", body: "Your contact also learns whether you checked in on time." },
  { value: "plan_checkin_location", title: "Plan, check-in and my location note", body: "Adds a short location note you write yourself, only when you check in. Time-limited; deleted after the date. Never used for matching." },
];

/** D04 Share & check in: member-controlled safety plan. No silent tracking. */
export default function DateSafetyPage({ params }: { params: Promise<{ dateId: string }> }) {
  const { dateId } = use(params);
  const { me } = useRequireMember();
  const qc = useQueryClient();
  const plan = useDatePlan(dateId);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("");
  const [scope, setScope] = useState("plan_and_checkin");
  const [checkAt, setCheckAt] = useState("");
  const [escalation, setEscalation] = useState<"contact" | "contact_and_support">("contact");
  const [locationNote, setLocationNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (plan.data?.check_in && !name) {
      setName(plan.data.check_in.trusted_contact_name);
      setScope(plan.data.check_in.share_scope);
    }
  }, [plan.data, name]);

  const run = async (label: string, fn: () => Promise<DatePlan>) => {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      qc.setQueryData(["date-plan", dateId], next);
      qc.invalidateQueries({ queryKey: ["date-plans"] });
      return next;
    } catch (e) {
      setError(e as ApiError);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const next = await run("save", () => post<DatePlan>(`/date-plans/${dateId}/check-in`, { trusted_contact_name: name.trim(), trusted_contact_channel: channel.trim(), share_scope: scope, check_at: checkAt ? new Date(checkAt).toISOString() : null, escalation_preference: escalation }));
    if (next) setSaved(true);
  };
  const now = (state: "checked_in" | "escalated") => run(state, () => post<DatePlan>(`/date-plans/${dateId}/check-in/now`, { state, location_note: scope === "plan_checkin_location" && locationNote.trim() ? locationNote.trim() : null }));

  const p = plan.data;
  const ci = p?.check_in ?? null;
  const canConfigure = p?.status === "confirmed";
  const tz = p?.timezone ?? me?.timezone;

  return (
    <AppShell>
      <PageTitle eyebrow="Share & check in" title="Your safety plan for this date" lede="You decide who knows what, and for how long. We never track you silently, and nothing here is used for matching." />
      {plan.isLoading && <Skeleton lines={5} label="Loading the date" />}
      {plan.error && <ErrorState error={plan.error as ApiError} retry={() => plan.refetch()} />}
      <EmergencyCard emergency={{ number: "112", note: p?.safety.emergency ? `${p.safety.emergency} — local emergency services.` : "EU-wide emergency number." }} />
      <ErrorState error={error} />
      {p && (
        <>
          {ci && (
            <Card className="mb-4 border-action">
              <h2 className="mb-1 font-bold">During the date</h2>
              <p className="mb-3 text-sm text-ink-secondary">
                Check-in due {formatDateTime(ci.check_at, tz)}. Current state: <strong>{ci.state.replace(/_/g, " ")}</strong>. Sharing ends {formatDateTime(ci.expires_at, tz)}.
              </p>
              {scope === "plan_checkin_location" && (
                <Field label="Where you are right now (optional, in your words)" htmlFor="loc" help="Shared with your trusted contact only when you press a button below. Deleted after the sharing window. Never precise coordinates.">
                  <TextInput id="loc" maxLength={200} value={locationNote} onChange={(e) => setLocationNote(e.target.value)} placeholder="e.g. Still at the café on the square" />
                </Field>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button fullWidth loading={busy === "checked_in"} onClick={() => now("checked_in")}>
                  I'm okay
                </Button>
                <Button fullWidth variant="danger" loading={busy === "escalated"} onClick={() => now("escalated")}>
                  I need help
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-tertiary">“I need help” alerts {ci.trusted_contact_name}{escalation === "contact_and_support" ? " and our support team" : ""}. It does not call emergency services: use {p.safety.emergency} for that.</p>
            </Card>
          )}
          {!canConfigure && !ci && <StatusBanner type="info" title="Check-ins open once the date is confirmed" body="You can read the options now and set it up as soon as you both confirm." action={<LinkButton href={`/dates/${p.id}`} variant="secondary">Back to the date</LinkButton>} />}
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Trusted contact</h2>
            <p className="mb-3 text-sm text-ink-secondary">Someone you'd want to know the plan. They don't need the app. We share only what you choose below.</p>
            <Field label="Their name" htmlFor="cname">
              <TextInput id="cname" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} disabled={!canConfigure} autoComplete="off" />
            </Field>
            <Field label="How to reach them" htmlFor="cchan" help="Phone number, WhatsApp or email. Used only if you check in late or ask for help.">
              <TextInput id="cchan" maxLength={120} value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!canConfigure} placeholder="+39 … or name@example.com" autoComplete="off" />
            </Field>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">What they can see</h2>
            <div role="radiogroup" aria-label="Share scope" className="space-y-2">
              {SCOPES.map((s) => (
                <ChoiceCard key={s.value} title={s.title} body={s.body} selected={scope === s.value} disabled={!canConfigure} onSelect={() => setScope(s.value)} />
              ))}
            </div>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Check-in time and escalation</h2>
            <Field label="Check in by" htmlFor="checkat" help={`Leave blank to use the end of the date${p.ends_at ? ` (${formatDateTime(p.ends_at, tz)})` : ""}.`}>
              <TextInput id="checkat" type="datetime-local" value={checkAt} onChange={(e) => setCheckAt(e.target.value)} disabled={!canConfigure} />
            </Field>
            <Field label="If you miss the check-in or ask for help" htmlFor="esc">
              <Select id="esc" value={escalation} onChange={(e) => setEscalation(e.target.value as "contact" | "contact_and_support")} disabled={!canConfigure}>
                <option value="contact">Alert my trusted contact only</option>
                <option value="contact_and_support">Alert my trusted contact and the support team</option>
              </Select>
            </Field>
          </Card>
          <Button fullWidth loading={busy === "save"} disabled={!canConfigure || name.trim().length < 1 || channel.trim().length < 3} onClick={save}>
            {saved ? "Safety plan saved ✓" : ci ? "Update my safety plan" : "Enable my safety plan"}
          </Button>
          <LinkButton href={`/dates/${p.id}`} variant="ghost" fullWidth className="mt-2">
            Back to the date
          </LinkButton>
        </>
      )}
    </AppShell>
  );
}
