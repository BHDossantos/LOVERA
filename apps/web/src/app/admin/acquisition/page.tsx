"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { Button, Card, ErrorState, Select, Skeleton, StatusBanner } from "@/components/ui";
import { AdminShell, Table, Td } from "@/components/admin/AdminShell";

type Campaign = { code: string; source: string; label: string };
type Cohort = {
  campaign_code: string | null;
  source: string;
  label: string;
  signups: number | null;
  verification_completed: number | null;
  blueprint_confirmed: number | null;
  profile_completed: number | null;
};
type AcquisitionReport = {
  days: number;
  window_start: string;
  window_end: string;
  minimum_cohort_size: number;
  campaigns: Campaign[];
  cohorts: Cohort[];
};

const WINDOWS = [7, 30, 90] as const;
const campaignPath = (code: string) => `/welcome?campaign=${encodeURIComponent(code)}`;

function Count({ value }: { value: number | null }) {
  return value === null ? (
    <span className="text-xs font-medium text-ink-secondary" aria-describedby="acquisition-disclosure">Withheld</span>
  ) : (
    <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>
  );
}

/** First-signup cohorts only. The API enforces the admin boundary and withholds small cells. */
export default function AdminAcquisitionPage() {
  const { me } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [copyStatus, setCopyStatus] = useState("");
  const q = useQuery({
    queryKey: ["admin", "acquisition", days],
    queryFn: () => get<AcquisitionReport>(`/admin/acquisition?days=${days}`),
    enabled: !!me?.roles.includes("admin"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const report = q.data;

  async function copyLink(campaign: Campaign) {
    try {
      await navigator.clipboard.writeText(new URL(campaignPath(campaign.code), window.location.origin).href);
      setCopyStatus(`Link copied for ${campaign.label}.`);
    } catch {
      setCopyStatus("Clipboard unavailable. Use your browser’s copy-link action on the campaign link.");
    }
  }

  return (
    <AdminShell title="Acquisition insights" roles={["admin"]}>
      <p className="mb-6 max-w-2xl text-ink-secondary">
        See which campaign placements bring new members into Lovera and how those members progress through onboarding.
      </p>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <label htmlFor="acquisition-window" className="mb-1 block text-sm font-semibold">Signup window</label>
          <Select id="acquisition-window" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {WINDOWS.map((window) => <option key={window} value={window}>Last {window} days</option>)}
          </Select>
        </div>
        <Button variant="secondary" size="sm" onClick={() => q.refetch()} loading={q.isFetching} disabled={!me?.roles.includes("admin")}>Refresh report</Button>
      </div>

      {q.isLoading && <Skeleton lines={6} label="Loading acquisition report" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {report && (
        <>
          <section aria-labelledby="acquisition-progress" className="mb-7">
            <h2 id="acquisition-progress" className="mb-2 text-lg font-bold">New-member progress</h2>
            <p className="mb-3 text-sm text-ink-secondary">
              First signups from {formatDateTime(report.window_start, "UTC")} to {formatDateTime(report.window_end, "UTC")} UTC.
              Each column counts distinct members with a recorded milestone by the end of this report. Staff accounts are excluded.
            </p>
            <Table caption="New-member progress by acquisition source" headers={["Source", "Signups", "Verified", "Blueprint confirmed", "Profile milestone"]}>
              {report.cohorts.map((cohort) => (
                <tr key={cohort.campaign_code ?? cohort.source}>
                  <th scope="row" className="min-w-44 px-3 py-3 text-sm font-semibold text-ink">
                    {cohort.label}
                    {cohort.campaign_code && <span className="mt-1 block font-mono text-xs font-normal text-ink-secondary">{cohort.campaign_code}</span>}
                  </th>
                  <Td><Count value={cohort.signups} /></Td>
                  <Td><Count value={cohort.verification_completed} /></Td>
                  <Td><Count value={cohort.blueprint_confirmed} /></Td>
                  <Td><Count value={cohort.profile_completed} /></Td>
                </tr>
              ))}
            </Table>
            <p id="acquisition-disclosure" className="mt-3 text-sm text-ink-secondary">
              “Withheld” includes zero and counts below {report.minimum_cohort_size}, plus values that could reveal a small group by subtraction.
              It does not mean there were no signups. Campaign rows are always shown, even before anyone joins.
            </p>
          </section>

          <StatusBanner type="info" title="Read this as onboarding progress" body="Verification counts successful checks. Blueprint counts a confirmed version. Profile milestone counts a recorded profile-completion event; it does not establish current matching eligibility. These are separate milestones, so the columns are not a strict conversion funnel. Attribution records the approved link used at first signup and does not change on later sign-ins." />

          <Card aria-labelledby="campaign-links">
            <h2 id="campaign-links" className="text-lg font-bold">Approved campaign links</h2>
            <p className="mt-1 text-sm text-ink-secondary">Use the matching link in each Rome campaign. Copying uses the current site address; check that you are on the intended live site before sharing.</p>
            <ul className="mt-4 divide-y divide-border">
              {report.campaigns.map((campaign) => (
                <li key={campaign.code} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{campaign.label}</p>
                    <a className="break-all text-sm text-action underline underline-offset-2" href={campaignPath(campaign.code)} target="_blank" rel="noreferrer">
                      {campaignPath(campaign.code)}
                    </a>
                  </div>
                  <Button variant="secondary" size="sm" aria-label={`Copy link for ${campaign.label}`} onClick={() => copyLink(campaign)}>Copy link</Button>
                </li>
              ))}
            </ul>
            <p role="status" className="mt-2 min-h-5 text-sm text-ink-secondary">{copyStatus}</p>
          </Card>
        </>
      )}
    </AdminShell>
  );
}
