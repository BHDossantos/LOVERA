"use client";

import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, Field, PageTitle, Select, StatusBanner, TextInput, Toggle } from "@/components/ui";

/** Y04 Travel mode: designed and visible, honestly disabled until after the single-city pilot. */
export default function TravelPage() {
  const { me } = useRequireMember();
  const enabled = me?.capabilities.entitlements.travel_mode ?? false;
  return (
    <AppShell>
      <PageTitle eyebrow="You · Travel mode" title="Time-bounded matching in another city" lede="Tell both sides you're visiting, pause your home city while you're away, and see what inventory looks like before you commit. Exact accommodation is never collected." />
      {!enabled && <StatusBanner type="info" title="Arrives after the single-city pilot" body="We're proving reciprocal acceptance, date completion and mutual second dates in one city first. The form below shows exactly what Travel mode will ask for; nothing here is saved yet." />}
      <fieldset disabled={!enabled} className="disabled:opacity-70">
        <Card className="mb-4">
          <Field label="Destination" htmlFor="dest" help="City only. Neighbourhood and accommodation are never asked.">
            <Select id="dest" defaultValue="">
              <option value="">Choose a city…</option>
              <option value="rome">Rome</option>
              <option value="barcelona">Barcelona</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Arriving" htmlFor="from">
              <TextInput id="from" type="date" />
            </Field>
            <Field label="Leaving" htmlFor="to">
              <TextInput id="to" type="date" />
            </Field>
          </div>
        </Card>
        <Card className="mb-4">
          <Toggle checked={true} onChange={() => undefined} label="Visitor disclosure (always on)" description="Introductions in the destination see “Visiting until <date>”. Travel status is explicit to both people." />
          <Toggle checked={true} onChange={() => undefined} label="Pause home-city introductions while away" description="Existing conversations continue. No new home-city introductions until you're back." />
        </Card>
        <Card className="mb-4">
          <h2 className="mb-1 font-bold">Inventory preview</h2>
          <p className="text-sm text-ink-secondary">Before enabling, you'll see how many verified members in the destination pass both sides' Must criteria for your dates. No names or photos in the preview.</p>
        </Card>
        <Button fullWidth disabled>
          {enabled ? "Enable travel mode for these dates" : "Not available during the pilot"}
        </Button>
      </fieldset>
    </AppShell>
  );
}
