"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, KeyValue, LinkButton, Modal, PageTitle, Select, Skeleton, StatusBanner } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CANCEL_REASONS, CalendarDownload, PlanHistory, StatusChip, shortWhen, useDatePlan } from "@/components/dates/shared";
import type { DatePlan } from "@/lib/types";

/** D03 Confirmed / proposed date: time, public venue, cancellation rules, who changed what, reconfirmation, discreet calendar, safety setup. */
export default function DateDetailPage({ params }: { params: Promise<{ dateId: string }> }) {
  const { dateId } = use(params);
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const plan = useDatePlan(dateId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("schedule");

  const apply = async (label: string, fn: () => Promise<DatePlan>) => {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      qc.setQueryData(["date-plan", dateId], next);
      await qc.invalidateQueries({ queryKey: ["date-plans"] });
      return next;
    } catch (e) {
      setError(e as ApiError);
      if ((e as ApiError).code === "VERSION_MISMATCH") plan.refetch();
      return null;
    } finally {
      setBusy(null);
    }
  };

  const respond = (action: "accept" | "decline") => plan.data && apply(action, () => post<DatePlan>(`/date-plans/${dateId}/respond`, { action }, { ifMatch: plan.data?.version }));
  const cancel = async () => {
    const next = await apply("cancel", () => post<DatePlan>(`/date-plans/${dateId}/cancel`, { reason }));
    setCancelOpen(false);
    if (next && reason === "safety") router.push("/safety");
  };

  const p = plan.data;
  const open = p && ["draft", "proposed", "countered", "confirmed"].includes(p.status);
  return (
    <AppShell>
      {plan.isLoading && <Skeleton lines={6} label="Loading the date" />}
      {plan.error && <ErrorState error={plan.error as ApiError} retry={() => plan.refetch()} />}
      {p && (
        <>
          <PageTitle eyebrow={`Date with ${p.other_display_name}`} title={p.starts_at ? formatDateTime(p.starts_at, p.timezone) : "Time not chosen yet"} lede={p.venue ? `${p.venue.name} · ${p.venue.coarse_area} · public place` : "No venue chosen yet."} />
          <div className="mb-4">
            <StatusChip plan={p} />
          </div>
          <ErrorState error={error} retry={error?.code === "VERSION_MISMATCH" ? () => plan.refetch() : undefined} />

          {p.awaiting_your_confirmation && (
            <StatusBanner
              type="caution"
              title={p.proposed_by_you ? "Your change needs their confirmation" : `${p.other_display_name} proposed this. Does it work for you?`}
              body="Nothing is fixed until you both confirm. Changing anything sends it back for reconfirmation."
              action={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button size="sm" loading={busy === "accept"} onClick={() => respond("accept")}>
                    {p.starts_at ? `Confirm ${p.venue?.name ?? "this venue"} on ${shortWhen(p.starts_at, p.timezone)}` : "Confirm this plan"}
                  </Button>
                  <LinkButton href={`/dates/new/venues?plan=${p.id}`} variant="secondary" className="text-sm">
                    Suggest a change
                  </LinkButton>
                  <Button size="sm" variant="ghost" loading={busy === "decline"} onClick={() => respond("decline")}>
                    This time doesn't work
                  </Button>
                </div>
              }
            />
          )}
          {(p.status === "proposed" || p.status === "countered") && !p.awaiting_your_confirmation && <StatusBanner type="info" title={`Waiting for ${p.other_display_name} to confirm`} body="You'll get a notification either way. You can still suggest a change." />}
          {p.status === "draft" && <StatusBanner type="info" title="No proposal yet" body="Choose an overlapping window and a public venue to propose." action={<LinkButton href={`/dates/new?plan=${p.id}`} variant="secondary">Choose a window</LinkButton>} />}
          {p.status === "cancelled" && <StatusBanner type="caution" title="This date was cancelled" body="You can plan another time from the conversation, or leave it here." />}
          {p.feedback_open && !p.feedback_submitted && <StatusBanner type="success" title="How did it go?" body="Your answers are private. A second-date yes is shown only if you both say yes." action={<LinkButton href={`/dates/${p.id}/feedback`}>Give private feedback</LinkButton>} />}
          {p.feedback_submitted && <StatusBanner type="info" title="Thanks for your private feedback" action={<LinkButton href={`/dates/${p.id}/mutual-second-date`} variant="secondary">See if it's mutual</LinkButton>} />}

          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Details</h2>
            <KeyValue
              items={[
                { k: "When", v: p.starts_at ? `${formatDateTime(p.starts_at, p.timezone)}${p.ends_at ? ` – ${shortWhen(p.ends_at, p.timezone).replace(/^\S+\s/, "")}` : ""}` : "—" },
                { k: "Where", v: p.venue ? `${p.venue.name}, ${p.venue.coarse_area}` : "—" },
                { k: "Style", v: p.date_style ? p.date_style.replace(/_/g, " ") : "—" },
                { k: "Price", v: p.venue?.price_band ?? "—" },
                { k: "Accessibility", v: p.venue ? Object.entries(p.venue.accessibility).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " ")).join(", ") || "none listed" : "—" },
                { k: "Time zone", v: p.timezone },
              ]}
            />
            {p.venue && <p className="mt-2 text-xs text-ink-tertiary">Directions: search the venue name in your maps app. We share the area, never an exact address or coordinates.</p>}
          </Card>

          {p.status === "confirmed" && (
            <Card className="mb-4">
              <h2 className="mb-2 font-bold">Discreet calendar entry</h2>
              <p className="mb-3 text-sm text-ink-secondary">The entry is titled “{p.calendar_title}” with the venue area only. Nothing about the app or the person appears.</p>
              <CalendarDownload plan={p} />
            </Card>
          )}

          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Safety setup</h2>
            <ul className="mb-3 list-disc pl-5 text-sm text-ink-secondary">
              {p.safety.guidance.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            {p.check_in ? (
              <p className="mb-3 text-sm text-ink">
                Check-in with <strong>{p.check_in.trusted_contact_name}</strong> at {formatDateTime(p.check_in.check_at, p.timezone)} · state: {p.check_in.state.replace(/_/g, " ")}
              </p>
            ) : (
              <p className="mb-3 text-sm text-ink-secondary">No trusted contact set up yet. Optional, free, and never tracked silently.</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <LinkButton href={`/dates/${p.id}/safety`} variant={p.status === "confirmed" ? "primary" : "secondary"}>
                {p.check_in ? "Manage check-in" : "Share plan and set a check-in"}
              </LinkButton>
              <LinkButton href="/safety" variant="ghost">
                Safety Center · {p.safety.emergency}
              </LinkButton>
            </div>
          </Card>

          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Who changed what</h2>
            <PlanHistory plan={p} meId={me?.id} />
            <p className="mt-3 text-sm text-ink-secondary">{p.cancellation_rules}</p>
          </Card>

          {open && (
            <div className="mt-6 border-t border-border pt-4">
              <Button variant="danger" fullWidth onClick={() => setCancelOpen(true)}>
                Cancel this date
              </Button>
            </div>
          )}
          <LinkButton href={`/messages/${p.conversation_id}`} variant="ghost" fullWidth className="mt-2">
            Back to the conversation
          </LinkButton>

          <Modal open={cancelOpen} title="Cancel this date?" onClose={() => setCancelOpen(false)}>
            <p className="mb-3 text-sm text-ink-secondary">
              {p.other_display_name} will be told the date is cancelled, not why. {p.cancellation_rules} This cannot be undone, but you can plan another time from the conversation.
            </p>
            <label htmlFor="reason" className="mb-1 block text-sm font-semibold">
              Reason (private)
            </label>
            <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {CANCEL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            {reason === "safety" && <p className="mt-2 text-sm text-ink">After cancelling we'll take you to the Safety Center. Blocking and reporting are private and never affect your matching.</p>}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button variant="danger" loading={busy === "cancel"} onClick={cancel}>
                Cancel the date
              </Button>
              <Button variant="secondary" onClick={() => setCancelOpen(false)}>
                Keep the date
              </Button>
            </div>
          </Modal>
        </>
      )}
    </AppShell>
  );
}
