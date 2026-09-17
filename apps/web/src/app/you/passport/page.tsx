"use client";

import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, Field, PageTitle, Select, StatusBanner, Toggle } from "@/components/ui";

/** X01 Dating Passport: a limited, revocable share link. Designed now, disabled during the pilot. */
export default function PassportPage() {
  const { me } = useRequireMember();
  const enabled = me?.capabilities.entitlements.dating_passport ?? false;
  return (
    <AppShell>
      <PageTitle eyebrow="You · Dating Passport" title="A revocable share link for a second opinion" lede="Show a friend a limited view of an introduction or your own profile. Dealbreakers, reports, precise location and hidden matching inferences are never included." />
      {!enabled && <StatusBanner type="info" title="Not available during the single-city pilot" body="This is a paid extension planned after the pilot proves mutual second dates. Below is the exact control set it will ship with; nothing is created yet." />}
      <fieldset disabled={!enabled} className="disabled:opacity-70">
        <Card className="mb-4">
          <h2 className="mb-2 font-bold">What the link includes</h2>
          <Toggle checked={true} onChange={() => undefined} label="Public profile facts and prompts" description="The same facts introductions see." />
          <Toggle checked={false} onChange={() => undefined} label="Why-this-person reasons" description="Plain-language reasons only, never scores." />
          <Toggle checked={false} onChange={() => undefined} label="Verification status" />
          <p className="mt-2 text-xs text-ink-tertiary">Never included: preferences and dealbreakers, Blueprint signals, safety reports, precise location, private feedback.</p>
        </Card>
        <Card className="mb-4">
          <Field label="Link expires" htmlFor="exp">
            <Select id="exp" defaultValue="24h">
              <option value="1h">In 1 hour</option>
              <option value="24h">In 24 hours</option>
              <option value="7d">In 7 days</option>
            </Select>
          </Field>
          <p className="text-sm text-ink-secondary">You'll see a view log (when it was opened, never by whom beyond what you shared) and can revoke the link at any time.</p>
        </Card>
        <Button fullWidth disabled>
          {enabled ? "Create a share link" : "Not available during the pilot"}
        </Button>
      </fieldset>
    </AppShell>
  );
}
