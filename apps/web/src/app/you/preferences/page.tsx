"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, patch, post } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, PageTitle, Skeleton, StatusBanner, TextInput, TierPill, TierSelect, cx } from "@/components/ui";
import { LANG_LABEL } from "@/lib/format";

type Option = { value: string; label: string };
type Pref = { id: string; key: string; label: string; description: string; tier: string; operator: string; value: Record<string, unknown>; options: Option[] | null; updated_at: string | null };
type Available = { key: string; label: string; description: string; default_tier: string; operator: string; options: Option[] | null };
type PrefsOut = { preferences: Pref[]; available: Available[]; tier_meaning: Record<string, string> };
type Impact = { key: string; tier: string; eligible_now: number; eligible_after: number; pool_size: number; message: string };
type Editing = { key: string; label: string; description: string; operator: string; options: Option[] | null; tier: string; value: Record<string, unknown>; isNew: boolean };

const CORE = new Set(["age_range", "distance_km", "children", "relationship_structure"]);

function describe(p: { key: string; operator: string; value: Record<string, unknown>; options: Option[] | null }) {
  const v = p.value as { min?: number; max?: number; in?: string[]; any_of?: string[] };
  if (p.key === "age_range") return v.min !== undefined ? `${v.min}–${v.max} years old` : "Not set";
  if (p.key === "distance_km") return v.max !== undefined ? `Within ${v.max} km` : "Not set";
  const list = v.in ?? v.any_of ?? [];
  if (!list.length) return "Any";
  return list.map((x) => p.options?.find((o) => o.value === x)?.label ?? LANG_LABEL[x] ?? x.replace(/_/g, " ")).join(", ");
}

/** Y03 Preferences & dealbreakers: every criterion labelled Must / Prefer / Open; edit one at a time; preview the trade-off before saving. */
export default function PreferencesPage() {
  const { me } = useRequireMember();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["preferences"], queryFn: () => get<PrefsOut>("/preferences"), enabled: !!me });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const startEdit = (p: Pref) => {
    setImpact(null);
    setEditing({ key: p.key, label: p.label, description: p.description, operator: p.operator, options: p.options, tier: p.tier, value: { ...p.value }, isNew: false });
  };
  const startAdd = (a: Available) => {
    setImpact(null);
    const value: Record<string, unknown> = a.key === "age_range" ? { min: 25, max: 45 } : a.key === "distance_km" ? { max: me?.max_distance_km ?? 25 } : a.operator === "any_of" ? { any_of: [] } : { in: [] };
    setEditing({ key: a.key, label: a.label, description: a.description, operator: a.operator, options: a.options ?? (a.key === "languages" ? Object.entries(LANG_LABEL).map(([value, label]) => ({ value, label })) : null), tier: a.default_tier, value, isNew: true });
  };

  const preview = async () => {
    if (!editing) return;
    setBusy("preview");
    setError(null);
    try {
      setImpact(await post<Impact>("/preferences/impact-preview", { key: editing.key, tier: editing.tier, value: editing.value }));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!editing) return;
    setBusy("save");
    setError(null);
    try {
      const next = await patch<PrefsOut>(`/preferences/${editing.key}`, { tier: editing.tier, value: editing.value });
      qc.setQueryData(["preferences"], next);
      qc.invalidateQueries({ queryKey: ["blueprint"] });
      setEditing(null);
      setImpact(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  };

  const setVal = (patchValue: Record<string, unknown>) => {
    setEditing((e) => (e ? { ...e, value: { ...e.value, ...patchValue } } : e));
    setImpact(null);
  };
  const listKey = editing?.operator === "any_of" ? "any_of" : "in";
  const list = (editing?.value[listKey] as string[] | undefined) ?? [];
  const overFiltering = impact && impact.eligible_after < impact.eligible_now && (impact.eligible_after <= 3 || impact.eligible_after < impact.eligible_now / 2);

  return (
    <AppShell>
      <PageTitle eyebrow="You · Preferences" title="Preferences and dealbreakers" lede="Must is a hard gate we never relax without you. Prefer is weighted. Open is used lightly. We show the trade-off before you save; we never pressure you to relax safety or core values." />
      {q.isLoading && <Skeleton lines={6} label="Loading your preferences" />}
      {q.error && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      <ErrorState error={error} />
      {q.data && q.data.preferences.length === 0 && !editing && <EmptyState title="No preferences saved yet" body="Core criteria are set during the Blueprint. You can add any criterion below." />}
      {q.data && !editing && (
        <>
          <Card className="mb-4">
            <h2 className="mb-2 font-bold">Your criteria</h2>
            <ul className="divide-y divide-border">
              {q.data.preferences.map((p) => (
                <li key={p.key} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{p.label}</span>
                      <TierPill tier={p.tier} />
                      {CORE.has(p.key) && <span className="text-xs text-ink-tertiary">core · set to Open rather than remove</span>}
                    </div>
                    <p className="text-sm text-ink-secondary">{describe(p)}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => startEdit(p)} aria-label={`Adjust ${p.label}`}>
                    Adjust
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
          {q.data.available.length > 0 && (
            <Card className="mb-4">
              <h2 className="mb-2 font-bold">Add a criterion</h2>
              <ul className="divide-y divide-border">
                {q.data.available.map((a) => (
                  <li key={a.key} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <span className="font-semibold text-ink">{a.label}</span>
                      <p className="text-sm text-ink-secondary">{a.description}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => startAdd(a)} aria-label={`Add ${a.label}`}>
                      + Add
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="text-xs text-ink-tertiary">Must: {q.data.tier_meaning.must} Prefer: {q.data.tier_meaning.prefer} Open: {q.data.tier_meaning.open}</p>
        </>
      )}
      {editing && (
        <Card className="mb-4">
          <h2 className="mb-1 font-bold">{editing.label}</h2>
          <p className="mb-3 text-sm text-ink-secondary">{editing.description}</p>
          <Field label="How strict" htmlFor="tier">
            <TierSelect value={editing.tier} onChange={(t) => { setEditing({ ...editing, tier: t }); setImpact(null); }} />
          </Field>
          {editing.key === "age_range" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Youngest" htmlFor="min">
                <TextInput id="min" type="number" min={18} max={99} value={String(editing.value.min ?? "")} onChange={(e) => setVal({ min: Number(e.target.value) })} />
              </Field>
              <Field label="Oldest" htmlFor="max">
                <TextInput id="max" type="number" min={18} max={99} value={String(editing.value.max ?? "")} onChange={(e) => setVal({ max: Number(e.target.value) })} />
              </Field>
            </div>
          )}
          {editing.key === "distance_km" && (
            <Field label="Maximum distance (km)" htmlFor="dist" help="Realistic for regular dates. Distance is always a coarse band, never an address.">
              <TextInput id="dist" type="number" min={1} max={200} value={String(editing.value.max ?? "")} onChange={(e) => setVal({ max: Number(e.target.value) })} />
            </Field>
          )}
          {editing.options && (
            <Field label="Accept" htmlFor="opts" help="Choose everything you'd be happy with. Leaving it empty means any.">
              <div id="opts" className="flex flex-wrap gap-2" role="group" aria-label="Accepted values">
                {editing.options.map((o) => {
                  const on = list.includes(o.value);
                  return (
                    <button key={o.value} type="button" aria-pressed={on} onClick={() => setVal({ [listKey]: on ? list.filter((x) => x !== o.value) : [...list, o.value] })} className={cx("rounded-full border px-3 py-2 text-sm font-semibold", on ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary")}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          {impact && (
            <StatusBanner
              type={overFiltering ? "caution" : "info"}
              title={`Eligible now: ${impact.eligible_now} → after this change: ${impact.eligible_after} (of ${impact.pool_size} verified, active, reciprocal members)`}
              body={overFiltering ? `This narrows things a lot. That's your call: ${impact.message}` : impact.message}
            />
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            {!impact ? (
              <Button loading={busy === "preview"} onClick={preview}>
                Preview the trade-off
              </Button>
            ) : (
              <Button loading={busy === "save"} onClick={save}>
                {editing.isNew ? `Add ${editing.label} as ${editing.tier}` : `Save ${editing.label} as ${editing.tier}`}
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setEditing(null); setImpact(null); }}>
              Keep it as it was
            </Button>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
