"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, newIdempotencyKey, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, ErrorState, Field, LinkButton, PageTitle, StatusBanner, TextArea, TextInput, Toggle, cx } from "@/components/ui";
import { CATEGORY_LABEL, EmergencyCard, LeaveSafely, PROTECTION_LABEL, SEVERITY_LABEL, type SafetyCase, type SafetyCenter } from "@/components/safety/shared";

const URGENCY = [
  { value: "happening_now", title: "Happening right now", body: "Ongoing or about to happen." },
  { value: "recent", title: "In the last few days" },
  { value: "past", title: "A while ago" },
  { value: "not_urgent", title: "Not urgent", body: "I want it on record." },
];

/** S02 Report flow: block first, minimum questions, skippable narrative, optional evidence, receipt. Leave-safely at every step. */
function ReportInner() {
  const { me } = useRequireMember({ allowRestricted: true, allowOnboarding: true });
  const qc = useQueryClient();
  const params = useSearchParams();
  const subjectParam = params.get("subject");
  const conversationId = params.get("conversation");
  const datePlanId = params.get("date");
  const center = useQuery({ queryKey: ["safety"], queryFn: () => get<SafetyCenter>("/safety"), enabled: !!me });
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [subjectId, setSubjectId] = useState(subjectParam ?? "");
  const [blockNow, setBlockNow] = useState(true);
  const [category, setCategory] = useState("");
  const [urgency, setUrgency] = useState("not_urgent");
  const [narrative, setNarrative] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [receipt, setReceipt] = useState<SafetyCase | null>(null);
  const [evidenceSaved, setEvidenceSaved] = useState<boolean | null>(null);
  const [key] = useState(() => newIdempotencyKey());

  const categories = center.data?.categories ?? Object.keys(CATEGORY_LABEL).map((k) => ({ key: k, severity: "" }));
  const severity = categories.find((c) => c.key === category)?.severity ?? "";
  const severe = severity === "P0" || severity === "P1" || urgency === "happening_now";

  const submit = async (withNarrative: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<SafetyCase>("/safety/reports", { subject_id: subjectId.trim() || null, category, urgency, narrative: withNarrative && narrative.trim() ? narrative.trim() : null, conversation_id: conversationId, date_plan_id: datePlanId, block_now: !!subjectId.trim() && blockNow, entry_surface: datePlanId ? "date" : conversationId ? "conversation" : "safety_center" }, { idempotencyKey: key });
      setReceipt(r);
      if (file) {
        try {
          const dataUrl = await toDataUrl(file);
          await post(`/safety/reports/${r.id}/evidence`, { content_type: file.type || "application/octet-stream", size_bytes: file.size, checksum: null, description: evidenceNote.trim() || null, data_url: dataUrl });
          setEvidenceSaved(true);
        } catch {
          setEvidenceSaved(false);
        }
      }
      qc.invalidateQueries({ queryKey: ["safety"] });
      qc.invalidateQueries({ queryKey: ["safety-cases"] });
      qc.invalidateQueries({ queryKey: ["blocks"] });
      setStep(4);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-context">{step < 4 ? `Report · step ${step} of 3` : "Report received"}</p>
        <LeaveSafely />
      </div>
      {severe && <EmergencyCard emergency={center.data?.emergency ?? { number: "112", note: "EU-wide emergency number." }} disclaimer={center.data?.disclaimer} />}
      <ErrorState error={error} />

      {step === 1 && (
        <>
          <PageTitle title="First: do you want them out of your space?" lede="You can block before telling us anything else. Blocking is silent and immediate: no more messages, introductions or dates with this person. You never have to explain." />
          <Card className="mb-4">
            <Field label="Who is this about?" htmlFor="subject" help={subjectParam ? "Filled in from where you started. Leave blank to report without naming anyone." : "Paste the member reference from their profile or conversation, or leave blank to report without naming anyone."}>
              <TextInput id="subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} placeholder="Member reference (optional)" autoComplete="off" />
            </Field>
            <Toggle checked={blockNow} onChange={setBlockNow} label="Block them now" description={subjectId.trim() ? "Applied the moment your report is saved. Your conversation closes for them as “unavailable”." : "Needs a member reference above."} />
          </Card>
          <Button fullWidth onClick={() => setStep(2)}>
            {subjectId.trim() && blockNow ? "Block them and continue" : "Continue without blocking"}
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <PageTitle title="What happened?" lede="Choose the closest match. This only decides who reviews it and how fast; you don't need to prove anything." />
          <Card className="mb-4">
            <div role="radiogroup" aria-label="Category" className="space-y-2">
              {categories.map((c) => {
                const meta = CATEGORY_LABEL[c.key] ?? { label: c.key.replace(/_/g, " "), help: "" };
                return <ChoiceCard key={c.key} title={meta.label} body={meta.help} badge={c.severity ? SEVERITY_LABEL[c.severity] : undefined} selected={category === c.key} onSelect={() => setCategory(c.key)} />;
              })}
            </div>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">When?</h2>
            <div role="radiogroup" aria-label="Urgency" className="space-y-2">
              {URGENCY.map((u) => (
                <ChoiceCard key={u.value} title={u.title} body={u.body} selected={urgency === u.value} onSelect={() => setUrgency(u.value)} />
              ))}
            </div>
          </Card>
          <Button fullWidth disabled={!category} onClick={() => setStep(3)}>
            {category ? "Continue" : "Choose what happened"}
          </Button>
          <Button variant="ghost" fullWidth className="mt-2" onClick={() => setStep(1)}>
            Back
          </Button>
        </>
      )}

      {step === 3 && (
        <>
          <PageTitle title="Anything you want to add? (optional)" lede="In your own words, as much or as little as you like. You can skip this entirely and still be protected." />
          <Card className="mb-4">
            <TextArea rows={5} maxLength={4000} value={narrative} onChange={(e) => setNarrative(e.target.value)} aria-label="What happened, in your words" placeholder="Optional" />
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Evidence (optional)</h2>
            <p className="mb-2 text-sm text-ink-secondary">A screenshot or photo, if you already have one. Never required, and we won't ask you to confront anyone to get one. Kept in a restricted vault with every access logged, for as long as the case needs it.</p>
            <label className={cx("inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 font-semibold", file && "border-action bg-action-soft text-action")}>
              <input type="file" accept="image/*,video/*,audio/*,.pdf,.txt" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {file ? `Attached: ${file.name}` : "+ Attach a file"}
            </label>
            {file && (
              <div className="mt-3">
                <Field label="What this shows (optional)" htmlFor="evnote">
                  <TextInput id="evnote" maxLength={300} value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} />
                </Field>
                <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                  Remove file
                </Button>
              </div>
            )}
          </Card>
          <Button fullWidth loading={busy} onClick={() => submit(true)}>
            {subjectId.trim() && blockNow ? "Send my report and block them" : "Send my report"}
          </Button>
          <Button variant="secondary" fullWidth className="mt-2" loading={busy} onClick={() => submit(false)}>
            Skip the details and send
          </Button>
          <Button variant="ghost" fullWidth className="mt-2" onClick={() => setStep(2)}>
            Back
          </Button>
        </>
      )}

      {step === 4 && receipt && (
        <>
          <PageTitle title="Thank you. You're protected." lede="A trained person will review this. You'll get updates in the app and can add information any time." />
          <Card className="mb-4">
            <p className="text-sm text-ink-secondary">Receipt code</p>
            <p className="text-2xl font-bold text-ink">{receipt.receipt_code}</p>
            <h2 className="mt-4 mb-1 font-bold">Protection applied</h2>
            <ul className="list-disc pl-5 text-ink">
              {receipt.protection_applied.length ? receipt.protection_applied.map((p) => <li key={p}>{PROTECTION_LABEL[p] ?? p.replace(/_/g, " ")}</li>) : <li>Your report is on record. No member was named, so no contact separation was needed.</li>}
            </ul>
            <p className="mt-3 text-sm text-ink-secondary">Response target: {receipt.response_target}.</p>
            {evidenceSaved === true && <p className="mt-1 text-sm text-success">✓ Evidence stored securely.</p>}
            {evidenceSaved === false && <StatusBanner type="caution" title="Evidence didn't upload" body="Your report is saved. You can add the file again from the case page." />}
            <p className="mt-2 text-xs text-ink-tertiary">{receipt.support.note} Reports never affect your matching.</p>
          </Card>
          <LinkButton href={`/safety/cases/${receipt.id}`} fullWidth>
            Track this case
          </LinkButton>
          <LinkButton href="/safety" variant="ghost" fullWidth className="mt-2">
            Back to the Safety Center
          </LinkButton>
        </>
      )}
    </AppShell>
  );
}

function toDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function ReportPage() {
  return (
    <Suspense>
      <ReportInner />
    </Suspense>
  );
}
