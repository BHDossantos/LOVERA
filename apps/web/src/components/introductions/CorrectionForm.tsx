"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, post } from "@/lib/api";
import { Button, Card, ErrorState, Field, Select, StatusBanner, TextArea } from "@/components/ui";
import type { BlueprintCurrent, CorrectionResult } from "./types";

/**
 * "Something wrong?" correction mechanism (I02/I03). Records a correction against the introduction and,
 * when a value is chosen, updates the member's own Blueprint signal through the versioned path.
 */
export function CorrectionForm({ introId, suggestedKeys = [], title = "Something wrong?" }: { introId: string; suggestedKeys?: string[]; title?: string }) {
  const qc = useQueryClient();
  const blueprint = useQuery({ queryKey: ["blueprint", "current"], queryFn: () => get<BlueprintCurrent>("/blueprint/current") });
  const signals = useMemo(() => blueprint.data?.signals ?? [], [blueprint.data]);
  const [signalKey, setSignalKey] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<CorrectionResult | null>(null);

  const ordered = useMemo(() => {
    const suggested = signals.filter((s) => suggestedKeys.includes(s.key));
    const rest = signals.filter((s) => !suggestedKeys.includes(s.key));
    return [...suggested, ...rest];
  }, [signals, suggestedKeys]);
  const activeKey = signalKey || ordered[0]?.key || "";
  const active = ordered.find((s) => s.key === activeKey);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeKey) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<CorrectionResult>(`/introductions/${introId}/correction`, { signal_key: activeKey, value: value || null, note: note.trim() || null });
      setResult(r);
      qc.invalidateQueries({ queryKey: ["introduction", introId] });
      qc.invalidateQueries({ queryKey: ["blueprint"] });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="correction-title">
      <h2 id="correction-title" className="text-lg font-bold text-ink">
        {title}
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">If an assumption about you is off, correct it here. Corrections update your own Blueprint only; they are never shown to the other member.</p>
      {result ? (
        <StatusBanner type="success" title="Correction recorded" body={result.message} />
      ) : (
        <form onSubmit={submit} className="mt-4">
          <ErrorState error={error} />
          {blueprint.isError && <ErrorState error={blueprint.error as ApiError} retry={() => blueprint.refetch()} />}
          <Field label="Which signal is wrong?" htmlFor="correction-signal" help={suggestedKeys.length ? "Signals we were unsure about are listed first." : undefined}>
            <Select id="correction-signal" value={activeKey} onChange={(e) => { setSignalKey(e.target.value); setValue(""); }} disabled={blueprint.isLoading}>
              {ordered.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                  {s.value_label ? ` (currently: ${s.value_label})` : " (not set)"}
                </option>
              ))}
            </Select>
          </Field>
          {active && (
            <Field label="Correct value" htmlFor="correction-value" help={active.special_category ? "This is a sensitive category. It is only ever used because you declared it, never inferred." : "Optional. Leave blank to flag the signal without changing it."}>
              <Select id="correction-value" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Just flag it as wrong</option>
                {active.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Note for the matchmaker (optional)" htmlFor="correction-note" help={`${note.length}/300`}>
            <TextArea id="correction-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should we know?" />
          </Field>
          <Button type="submit" variant="secondary" loading={busy} disabled={!activeKey}>
            Correct my Blueprint
          </Button>
        </form>
      )}
    </Card>
  );
}
