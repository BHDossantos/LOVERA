"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, del, get, post, put } from "@/lib/api";
import { useAuth, useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, ErrorState, KeyValue, Modal, PageTitle, Skeleton, StatusBanner, Toggle } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";

type Consent = { status: string; policy_version: string; changed_at: string | null };
type Privacy = {
  visibility_map: Record<string, string>;
  matching_data: string[];
  never_in_matching: string[];
  consents: Record<string, Consent>;
  status: string;
  deletion_due_at: string | null;
  requests: { id: string; type: string; status: string; requested_at: string; expires_at: string | null }[];
};
type ExportOut = { request_id: string; status: string; download_path: string; expires_at: string };

const POLICY_VERSION = "2026-09";
const CONSENTS: { key: string; label: string; body: string }[] = [
  { key: "ai_processing", label: "AI processing of my Blueprint and messages", body: "Needed for the interview, explanations, drafts and translation. Revoking pauses AI features; manual messaging and safety keep working." },
  { key: "special_category", label: "Use sensitive answers for matching", body: "Faith or similar categories you chose to share. Off means they are ignored, not deleted." },
  { key: "model_improvement", label: "Model improvement", body: "Off by default. Lets anonymised, non-safety data improve matching for everyone. Revoke prospectively any time." },
  { key: "marketing", label: "Marketing emails", body: "Product news only. Never sensitive inferences." },
];
const VIS_LABEL: Record<string, string> = { public: "Public", matching_only: "Matching only", matching_only_private: "Matching only · private", private: "Private", safety_only: "Safety only", never_stored: "Never stored" };

/** Y08 Privacy & account controls: visibility, matching-data map, consents, export, pause, deletion with grace period. */
export default function PrivacyPage() {
  const { me } = useRequireMember();
  const { refresh } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["privacy"], queryFn: () => get<Privacy>("/me/privacy"), enabled: !!me });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirm, setConfirm] = useState<"pause" | "delete" | null>(null);
  const [exported, setExported] = useState<ExportOut | null>(null);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["privacy"] });
      // Consent is the lawful basis for a sensitive criterion, so withdrawing or restoring it
      // changes the preferences and blueprint payloads too — both cached, and reachable without
      // a remount from the You hub.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["preferences"] }),
        qc.invalidateQueries({ queryKey: ["blueprint"] }),
      ]);
      await refresh();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const setConsent = (purpose: string, granted: boolean) => run(purpose, () => put(`/consents/${purpose}`, { status: granted ? "granted" : "revoked", policy_version: POLICY_VERSION }));
  const exportData = () =>
    run("export", async () => {
      const req = await post<ExportOut>("/me/export");
      setExported(req);
      const data = await get<unknown>(req.download_path.replace(/^\/v1/, ""));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `matchmaker-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  const download = (path: string) =>
    run("download", async () => {
      const data = await get<unknown>(path.replace(/^\/v1/, ""));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "matchmaker-export.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });

  const p = q.data;
  const paused = me?.paused ?? false;
  const deleting = !!(me?.deletion_due_at ?? p?.deletion_due_at);
  return (
    <AppShell>
      <PageTitle eyebrow="You · Privacy" title="Privacy and account controls" lede="Exercise your rights here, without contacting support. Raw ID, biometrics, precise location and reports never enter the compatibility model." />
      {q.isLoading && <Skeleton lines={6} label="Loading privacy overview" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      <ErrorState error={error} />
      {deleting && (
        <StatusBanner
          type="caution"
          title={`Deletion scheduled for ${formatDate(me?.deletion_due_at ?? p?.deletion_due_at)}`}
          body="Your profile is hidden now. Cancel before that date to keep everything; after it, personal data is erased except what the law requires us to keep (safety records, billing)."
          action={
            <Button size="sm" variant="secondary" loading={busy === "cancel-deletion"} onClick={() => run("cancel-deletion", () => post("/me/cancel-deletion"))}>
              Cancel deletion and keep my account
            </Button>
          }
        />
      )}
      {paused && !deleting && <StatusBanner type="info" title="Your account is paused" body="No new introductions and your profile is hidden from new people. Conversations, dates and safety tools keep working." action={<Button size="sm" variant="secondary" loading={busy === "resume"} onClick={() => run("resume", () => post("/me/resume"))}>Resume introductions</Button>} />}
      {p && (
        <>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Who sees what</h2>
            <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {Object.entries(p.visibility_map).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-2 border-b border-border py-1.5 text-sm">
                  <span className="text-ink">{k.replace(/_/g, " ")}</span>
                  <span className="font-semibold text-ink-secondary">{VIS_LABEL[v] ?? v}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Used for matching</h2>
            <ul className="mb-3 list-disc pl-5 text-sm text-ink">
              {p.matching_data.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <h3 className="mb-1 text-sm font-semibold">Never used for matching</h3>
            <ul className="list-disc pl-5 text-sm text-ink-secondary">
              {p.never_in_matching.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Consents</h2>
            <p className="mb-2 text-sm text-ink-secondary">Versioned and revocable. Terms, privacy notice and community agreement are required to hold an account; withdrawing them means deleting it.</p>
            {CONSENTS.map((c) => {
              const cur = p.consents[c.key];
              return <Toggle key={c.key} checked={cur?.status === "granted"} onChange={(v) => setConsent(c.key, v)} label={c.label} description={`${c.body}${cur?.changed_at ? ` Last changed ${formatDate(cur.changed_at)} (policy ${cur.policy_version}).` : " Not yet set."}`} />;
            })}
            <KeyValue items={["terms", "privacy", "community"].map((k) => ({ k: k === "terms" ? "Terms" : k === "privacy" ? "Privacy notice" : "Community agreement", v: p.consents[k] ? `Accepted · ${p.consents[k].policy_version}` : "Not yet accepted" }))} />
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Export my data</h2>
            <p className="mb-2 text-sm text-ink-secondary">A JSON file with your profile, Blueprint, preferences, consents, decisions, your messages and your feedback. Other people's messages, decisions, reports and internal scores are not included.</p>
            <Button variant="secondary" loading={busy === "export"} onClick={exportData}>
              Download my data (JSON)
            </Button>
            {exported && <p className="mt-2 text-xs text-ink-tertiary">Export {exported.request_id.slice(0, 8)} ready · link valid until {formatDateTime(exported.expires_at)}</p>}
            {p.requests.length > 0 && (
              <ul className="mt-3 divide-y divide-border text-sm">
                {p.requests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {r.type} · {r.status} · {formatDateTime(r.requested_at)}
                    </span>
                    {r.type === "export" && r.status === "ready" && (!r.expires_at || new Date(r.expires_at).getTime() > Date.now()) && (
                      <Button size="sm" variant="ghost" loading={busy === "download"} onClick={() => download(`/me/export/${r.id}`)}>
                        Download again
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="mb-4">
            <h2 className="mb-1 font-bold">Pause</h2>
            <p className="mb-2 text-sm text-ink-secondary">Take a break without losing anything. Reversible at any time.</p>
            {paused ? (
              <Button variant="secondary" loading={busy === "resume"} onClick={() => run("resume", () => post("/me/resume"))}>
                Resume introductions
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setConfirm("pause")} disabled={deleting}>
                Pause my account
              </Button>
            )}
          </Card>
          <Card className="mb-4 border-caution">
            <h2 className="mb-1 font-bold">Delete my account</h2>
            <p className="mb-2 text-sm text-ink-secondary">Starts a grace period during which you can change your mind. After it, your data is erased except records we must keep by law.</p>
            <Button variant="danger" onClick={() => setConfirm("delete")} disabled={deleting}>
              {deleting ? "Deletion already scheduled" : "Delete my account"}
            </Button>
          </Card>
          <Modal open={confirm === "pause"} title="Pause your account?" onClose={() => setConfirm(null)}>
            <ul className="mb-3 list-disc pl-5 text-sm text-ink-secondary">
              <li>No new introductions; your profile is hidden from new people.</li>
              <li>Existing conversations, dates and safety tools keep working.</li>
              <li>Paid time keeps running unless you also cancel in Membership.</li>
              <li>Resume any time with one tap.</li>
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button loading={busy === "pause"} onClick={() => run("pause", () => post("/me/pause")).then(() => setConfirm(null))}>
                Pause introductions
              </Button>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Keep going
              </Button>
            </div>
          </Modal>
          <Modal open={confirm === "delete"} title="Delete your account?" onClose={() => setConfirm(null)}>
            <ul className="mb-3 list-disc pl-5 text-sm text-ink-secondary">
              <li>Your profile disappears immediately; conversations close for the other person as “unavailable”.</li>
              <li>A grace period follows. You can cancel deletion from this page or by signing in.</li>
              <li>After the grace period: profile, Blueprint, preferences, messages and feedback are erased.</li>
              <li>Kept only where the law requires: safety records, billing records, and the fact that a consent existed.</li>
              <li>Consider exporting your data first.</li>
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="danger" loading={busy === "delete"} onClick={() => run("delete", () => del("/me")).then(() => { setConfirm(null); router.refresh(); })}>
                Start the deletion grace period
              </Button>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Keep my account
              </Button>
            </div>
          </Modal>
        </>
      )}
    </AppShell>
  );
}
