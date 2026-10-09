"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, put } from "@/lib/api";
import { Button, Card, ErrorState, Field, Select, Skeleton, Toggle } from "@/components/ui";

type Window = { weekday: number; start: string; end: string };
type Availability = { timezone: string | null; recurring_windows: Window[]; date_styles: string[]; date_ready: boolean; updated_at: string | null; policy: string };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STYLES = [["coffee", "Coffee"], ["walk", "A walk"], ["drinks", "Drinks"], ["dinner", "Dinner"], ["culture", "Museum or show"], ["activity", "An activity"]];
const HOURS = Array.from({ length: 16 }, (_, i) => `${String(i + 8).padStart(2, "0")}:00`);

export function AvailabilityEditor({ onSaved, cta = "Save availability" }: { onSaved?: () => void; cta?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["availability"], queryFn: () => get<Availability>("/availability") });
  const [windows, setWindows] = useState<Window[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [ready, setReady] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // `updated_at` is the only thing that tells "never saved" from "saved as empty": GET /availability
  // returns date_styles: [] for both, so seeding a default off `length` re-added a style the member
  // had deliberately removed, every visit, on the next save of anything else. date_styles gates and
  // scores nothing — it is only carried in the feature snapshot — so an empty list is a choice to
  // respect, not a gap to fill.
  useEffect(() => {
    if (q.data && !loaded) {
      const first = q.data.updated_at === null;
      setWindows(first ? [{ weekday: 3, start: "18:00", end: "22:00" }, { weekday: 5, start: "11:00", end: "17:00" }] : q.data.recurring_windows);
      setStyles(first ? ["coffee"] : q.data.date_styles);
      setReady(q.data.date_ready);
      setLoaded(true);
    }
  }, [q.data, loaded]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await put<Availability>("/availability", { recurring_windows: windows, date_styles: styles, date_ready: ready });
      qc.setQueryData(["availability"], next);
      onSaved?.();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  // The same on this side: a first load that fails has no data, so an unconditional skeleton left
  // the readiness editor loading for ever with no error and no retry. The button is unconditional
  // too, unlike ErrorState's own, because while this is the whole screen there is no other way on.
  if (!q.data) {
    if (q.isError && !q.isFetching)
      return (
        <Card>
          <ErrorState error={q.error as ApiError} />
          <Button variant="secondary" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </Card>
      );
    return <Skeleton lines={5} />;
  }
  return (
    <div>
      <ErrorState error={error} />
      <Card className="mb-4">
        <h2 className="mb-1 font-bold">Windows when you could meet</h2>
        <p className="mb-3 text-sm text-ink-secondary">{q.data.policy}</p>
        <ul className="space-y-2">
          {windows.map((w, i) => (
            <li key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
              <Field label="Day" htmlFor={`d${i}`}>
                <Select id={`d${i}`} value={w.weekday} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
                  {DAYS.map((d, k) => (
                    <option key={d} value={k}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From" htmlFor={`s${i}`}>
                <Select id={`s${i}`} value={w.start} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}>
                  {HOURS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </Select>
              </Field>
              <Field label="To" htmlFor={`e${i}`}>
                <Select id={`e${i}`} value={w.end} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}>
                  {HOURS.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </Select>
              </Field>
              <Button type="button" variant="ghost" size="sm" className="mb-4" aria-label={`Remove window ${i + 1}`} onClick={() => setWindows(windows.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="ghost" size="sm" onClick={() => setWindows([...windows, { weekday: 6, start: "10:00", end: "14:00" }])}>
          + Add a window
        </Button>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-2 font-bold">First-date style</h2>
        <div className="flex flex-wrap gap-2">
          {STYLES.map(([v, l]) => {
            const on = styles.includes(v);
            return (
              <button key={v} type="button" aria-pressed={on} onClick={() => setStyles(on ? styles.filter((s) => s !== v) : [...styles, v])} className={`rounded-full border px-3 py-2 text-sm font-semibold ${on ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary"}`}>
                {l}
              </button>
            );
          })}
        </div>
      </Card>
      <Card className="mb-6">
        <Toggle checked={ready} onChange={setReady} label="I'm ready to meet within two weeks" description="Off pauses introductions without hiding your profile from existing connections." />
      </Card>
      {/* A style as well as a window, which is what the mobile editor has always required. The
          two disagreeing is what let an empty list exist at all: saved on the web, then silently
          re-seeded with "coffee" on the next read. Nothing is pre-selected on the member's behalf
          now, so an empty stored list shows as empty and asks them to choose. */}
      <Button fullWidth loading={busy} disabled={windows.length === 0 || styles.length === 0} onClick={save}>
        {cta}
      </Button>
    </div>
  );
}
