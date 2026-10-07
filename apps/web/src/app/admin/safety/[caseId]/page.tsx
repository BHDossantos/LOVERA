"use client";

import { Suspense, use, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorState, Field, KeyValue, LinkButton, Modal, Select, Skeleton, StatusBanner, TextArea, TextInput, Toggle } from "@/components/ui";
import { AdminShell } from "@/components/admin/AdminShell";
import { CATEGORY_LABEL, CASE_STATUS_LABEL, SeverityTag } from "@/components/safety/shared";
import { formatDateTime } from "@/lib/format";

type EvidenceFile = { id: string; content_type: string; description: string | null; data_url: string; size_bytes: number; checksum: string | null; access_count: number };

type CaseDetail = {
  id: string;
  receipt_code: string;
  severity: string;
  category: string;
  urgency: string;
  status: string;
  specialist_workflow: string | null;
  narrative: string | null;
  reporter: { id: string; name: string };
  subject: { id: string | null; name: string; status: string | null };
  evidence: { id: string; content_type: string; description: string | null; collected_at: string; access_count: number }[];
  notes: { id: string; role: string; note: string; visible_to_reporter: boolean; at: string }[];
  actions: { id: string; type: string; scope: string; reason_code: string; decision_source: string; appealable: boolean; public_notice: string | null; ends_at: string | null; lifted_at: string | null }[];
  conversation_context: { from: string; text: string; at: string; flags: string[] }[];
  submitted_at: string;
};

const STATUSES = ["triaged", "assigned", "in_review", "awaiting_information", "actioned", "closed"];
const ACTION_TYPES = [
  ["no_action", "No violation: close and lift automatic restriction"],
  ["warning", "Warning"],
  ["capability_limit", "Capability limit"],
  ["restrict", "Restrict account"],
  ["suspend", "Suspend account"],
  ["ban", "Close account (ban)"],
];
const REASON_CODES = ["harassment", "scam_or_fraud", "impersonation", "threats", "hate_or_discrimination", "coercion", "stalking", "misleading_profile", "no_show", "no_violation", "other"];

/** Safety case detail. A declared purpose is required before anything loads; every open is audited. */
function CaseInner({ caseId }: { caseId: string }) {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const purpose = params.get("purpose") ?? "";
  const [purposeDraft, setPurposeDraft] = useState("");
  const q = useQuery({ queryKey: ["admin", "safety", "case", caseId, purpose], queryFn: () => get<CaseDetail>(`/admin/safety/cases/${caseId}?purpose=${encodeURIComponent(purpose)}`), enabled: !!me && purpose.length >= 3 });
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [visible, setVisible] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [aType, setAType] = useState("warning");
  const [aReason, setAReason] = useState(REASON_CODES[0]);
  const [aNotice, setANotice] = useState("");
  const [aDays, setADays] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // Fetched on demand rather than with the case: a reviewer reading the narrative does not need
  // every attachment's bytes, and each open is a separate audited access.
  const [opened, setOpened] = useState<Record<string, EvidenceFile>>({});

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["admin", "safety"] });
      await qc.invalidateQueries({ queryKey: ["admin", "marketplace"] });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };
  const update = () => run("update", () => post(`/admin/safety/cases/${caseId}`, { status: status || null, note: note.trim() || null, visible_to_reporter: visible, purpose })).then(() => { setNote(""); setStatus(""); });
  const applyAction = () => run("action", () => post(`/admin/safety/cases/${caseId}/actions`, { type: aType, reason_code: aReason, public_notice: aNotice.trim() || null, duration_days: aDays ? Number(aDays) : null, purpose })).then(() => setActionOpen(false));

  /**
   * Open one attachment.
   *
   * Until this existed the reporter was told the reviewer would see their screenshot and the
   * reviewer could see its MIME type. On a harassment report the screenshot is usually the whole
   * substance of the case, so the attachment list was a vault with no door.
   */
  const openEvidence = (id: string) =>
    run(`evidence:${id}`, async () => {
      const file = await get<EvidenceFile>(`/admin/safety/evidence/${id}?purpose=${encodeURIComponent(purpose)}`);
      setOpened((prev) => ({ ...prev, [id]: file }));
    });

  if (purpose.length < 3) {
    return (
      <Card className="max-w-lg">
        <h2 className="mb-1 font-bold">Declare a purpose before opening this case</h2>
        <p className="mb-3 text-sm text-ink-secondary">Sensitive member context (narrative, evidence, conversation) is shown only against a logged reason. The reason and access are recorded in the audit trail.</p>
        <Field label="Purpose" htmlFor="purpose" help="For example: case_review, appeal_review, escalation, legal_request.">
          <TextInput id="purpose" value={purposeDraft} onChange={(e) => setPurposeDraft(e.target.value)} placeholder="case_review" />
        </Field>
        <Button disabled={purposeDraft.trim().length < 3} onClick={() => router.replace(`/admin/safety/${caseId}?purpose=${encodeURIComponent(purposeDraft.trim())}`)}>
          Open the case with this purpose
        </Button>
        <LinkButton href="/admin/safety" variant="ghost" className="ml-2">
          Back to the queue
        </LinkButton>
      </Card>
    );
  }

  const c = q.data;
  return (
    <>
      <ErrorState error={error} />
      {q.isLoading && <Skeleton lines={8} label="Loading the case" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {c && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div>
            <Card className="mb-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold">
                  {c.receipt_code} · {CATEGORY_LABEL[c.category]?.label ?? c.category}
                </h2>
                <SeverityTag severity={c.severity} />
              </div>
              <KeyValue
                items={[
                  { k: "Status", v: CASE_STATUS_LABEL[c.status] ?? c.status },
                  { k: "Urgency", v: c.urgency.replace(/_/g, " ") },
                  { k: "Specialist workflow", v: c.specialist_workflow ?? "—" },
                  { k: "Reporter", v: c.reporter.name },
                  { k: "Subject", v: `${c.subject.name}${c.subject.status ? ` · ${c.subject.status}` : ""}` },
                  { k: "Submitted", v: formatDateTime(c.submitted_at) },
                  { k: "Access purpose (audited)", v: purpose },
                ]}
              />
              <p className="mt-2 text-xs text-ink-tertiary">Reporter identity is never disclosed to the subject. Do not paste it into public notices.</p>
            </Card>
            <Card className="mb-4">
              <h2 className="mb-1 font-bold">Narrative</h2>
              <p className="whitespace-pre-wrap text-ink">{c.narrative ?? "The reporter chose not to add a narrative."}</p>
            </Card>
            <Card className="mb-4">
              <h2 className="mb-1 font-bold">Evidence ({c.evidence.length})</h2>
              {c.evidence.length === 0 && <p className="text-sm text-ink-secondary">None attached. Never require the reporter to obtain more.</p>}
              <ul className="divide-y divide-border text-sm">
                {c.evidence.map((e) => {
                  const file = opened[e.id];
                  return (
                    <li key={e.id} className="py-2">
                      <span className="font-semibold">{e.content_type}</span> · collected {formatDateTime(e.collected_at)} · opened {e.access_count}×
                      {e.description && <p className="text-ink-secondary">{e.description}</p>}
                      {!file && (
                        <Button variant="secondary" className="mt-1" loading={busy === `evidence:${e.id}`} onClick={() => openEvidence(e.id)}>
                          Open this attachment
                        </Button>
                      )}
                      {file && (
                        <div className="mt-2">
                          {/* An attachment is whatever the reporter had to hand, so the type decides
                              what can be shown. An image is rendered; anything else gets the
                              download, because guessing wrong here means a reviewer concluding
                              there is nothing to see. */}
                          {file.content_type.startsWith("image/") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={file.data_url} alt={file.description ?? "Evidence attached by the reporter"} className="max-h-[32rem] w-auto rounded-[var(--radius-md)] border border-border" />
                          ) : (
                            <p className="text-sm text-ink-secondary">{file.content_type} cannot be previewed here. Download it below.</p>
                          )}
                          <a href={file.data_url} download={`evidence-${file.id}`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-action">
                            Download ({Math.max(1, Math.round(file.size_bytes / 1024))} KB)
                          </a>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-ink-tertiary">Files live in the restricted vault. Opening one is a separate audited access against the purpose you declared, and is counted on the attachment.</p>
            </Card>
            <Card className="mb-4">
              <h2 className="mb-1 font-bold">Conversation context (last 20)</h2>
              {c.conversation_context.length === 0 && <p className="text-sm text-ink-secondary">No linked conversation.</p>}
              <ol className="space-y-2 text-sm">
                {c.conversation_context.map((m, i) => (
                  <li key={i} className={`rounded-[var(--radius-md)] p-2 ${m.from === "subject" ? "bg-caution-soft" : "bg-surface-muted"}`}>
                    <span className="font-semibold">{m.from}</span> · {formatDateTime(m.at)}
                    {m.flags.length > 0 && <span className="ml-2 rounded-full bg-context-soft px-2 text-xs text-context">flags: {m.flags.join(", ")}</span>}
                    <p className="whitespace-pre-wrap text-ink">{m.text}</p>
                  </li>
                ))}
              </ol>
            </Card>
            <Card className="mb-4">
              <h2 className="mb-1 font-bold">Notes</h2>
              <ol className="divide-y divide-border text-sm">
                {c.notes.map((n) => (
                  <li key={n.id} className="py-2">
                    <span className="font-semibold">{n.role}</span> · {formatDateTime(n.at)} · {n.visible_to_reporter ? "visible to reporter" : "internal"}
                    <p className="whitespace-pre-wrap text-ink">{n.note}</p>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
          <div>
            <Card className="mb-4">
              <h2 className="mb-2 font-bold">Update case</h2>
              <Field label="Status" htmlFor="cs">
                <Select id="cs" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Keep current</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {CASE_STATUS_LABEL[s] ?? s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" htmlFor="cn">
                <TextArea id="cn" rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Toggle checked={visible} onChange={setVisible} label="Visible to the reporter" description="Sends them a notification. Never include the subject's private data." />
              <Button fullWidth className="mt-2" loading={busy === "update"} disabled={!status && !note.trim()} onClick={update}>
                Save update
              </Button>
            </Card>
            <Card className="mb-4">
              <h2 className="mb-1 font-bold">Decision</h2>
              <p className="mb-2 text-sm text-ink-secondary">High-impact. Requires a reason code; the subject gets a notice and a human appeal route.</p>
              {c.actions.length > 0 && (
                <ul className="mb-2 divide-y divide-border text-sm">
                  {c.actions.map((a) => (
                    <li key={a.id} className="py-2">
                      <span className="font-semibold">{a.type.replace(/_/g, " ")}</span> · {a.scope} · {a.reason_code} · {a.decision_source}
                      {a.lifted_at ? ` · lifted ${formatDateTime(a.lifted_at)}` : a.ends_at ? ` · until ${formatDateTime(a.ends_at)}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <Button fullWidth variant="secondary" onClick={() => setActionOpen(true)} disabled={!c.subject.id}>
                {c.subject.id ? "Apply an action" : "No subject named"}
              </Button>
            </Card>
            <LinkButton href="/admin/safety" variant="ghost" fullWidth>
              Back to the queue
            </LinkButton>
          </div>
        </div>
      )}
      <Modal open={actionOpen} title="Apply an action" onClose={() => setActionOpen(false)}>
        <Field label="Action" htmlFor="at">
          <Select id="at" value={aType} onChange={(e) => setAType(e.target.value)}>
            {ACTION_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reason code" htmlFor="ar">
          <Select id="ar" value={aReason} onChange={(e) => setAReason(e.target.value)}>
            {REASON_CODES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
        {aType !== "no_action" && (
          <>
            <Field label="Public notice to the subject (optional)" htmlFor="an" help="Plain language. Never name or hint at the reporter.">
              <TextArea id="an" rows={3} maxLength={300} value={aNotice} onChange={(e) => setANotice(e.target.value)} />
            </Field>
            <Field label="Duration in days (blank = until reviewed)" htmlFor="ad">
              <TextInput id="ad" type="number" min={1} max={365} value={aDays} onChange={(e) => setADays(e.target.value)} />
            </Field>
          </>
        )}
        <StatusBanner type={aType === "ban" || aType === "suspend" ? "caution" : "info"} title={aType === "no_action" ? "Closes the case as no violation and lifts the automatic restriction" : `Consequence: ${ACTION_TYPES.find(([v]) => v === aType)?.[1] ?? aType}`} body={aType === "restrict" || aType === "suspend" || aType === "ban" ? "The subject's account status becomes restricted, they are notified, and can appeal to a different reviewer." : "The subject is notified and can appeal to a different reviewer."} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant={aType === "ban" || aType === "suspend" ? "danger" : "primary"} loading={busy === "action"} onClick={applyAction}>
            Apply {aType.replace(/_/g, " ")}
          </Button>
          <Button variant="secondary" onClick={() => setActionOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  );
}

export default function AdminCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  return (
    <AdminShell title="Safety case" roles={["safety_reviewer", "admin"]}>
      <Suspense>
        <CaseInner caseId={caseId} />
      </Suspense>
    </AdminShell>
  );
}
