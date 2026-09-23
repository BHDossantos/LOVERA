import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, put } from "@/api/client";
import { Button, Card, ChipGroup, ErrorState, Field, Loading, Options, Toggle } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

type Window = { weekday: number; start: string; end: string };
type Availability = {
  timezone: string | null;
  recurring_windows: Window[];
  date_styles: string[];
  date_ready: boolean;
  policy: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STYLES = [
  { value: "coffee", label: "Coffee" },
  { value: "walk", label: "A walk" },
  { value: "drinks", label: "Drinks" },
  { value: "dinner", label: "Dinner" },
  { value: "culture", label: "Museum or show" },
  { value: "activity", label: "An activity" },
];
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

  useEffect(() => {
    if (q.data && !loaded) {
      setWindows(
        q.data.recurring_windows.length
          ? q.data.recurring_windows
          : [
              { weekday: 3, start: "18:00", end: "22:00" },
              { weekday: 5, start: "11:00", end: "17:00" },
            ],
      );
      setStyles(q.data.date_styles.length ? q.data.date_styles : ["coffee"]);
      setReady(q.data.date_ready);
      setLoaded(true);
    }
  }, [q.data, loaded]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await put<Availability>("/availability", {
        recurring_windows: windows,
        date_styles: styles,
        date_ready: ready,
      });
      qc.setQueryData(["availability"], next);
      onSaved?.();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const set = (i: number, patch: Partial<Window>) =>
    setWindows(windows.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  if (!q.data) return <Loading label="Loading your availability" />;

  return (
    <View>
      <ErrorState error={error} />
      <Card>
        <Text style={s.h2}>Windows when you could meet</Text>
        <Text style={s.note}>{q.data.policy}</Text>
        {windows.map((w, i) => (
          <View key={i} style={s.window}>
            <Field label="Day">
              <ChipGroup
                values={[String(w.weekday)]}
                onChange={(v) => {
                  const picked = v.find((x) => x !== String(w.weekday));
                  if (picked !== undefined) set(i, { weekday: Number(picked) });
                }}
                options={DAYS.map((d, k) => ({ value: String(k), label: d }))}
              />
            </Field>
            <Field label="From">
              <Options value={w.start} onChange={(v) => set(i, { start: v })} options={HOURS.map((h) => ({ value: h, label: h }))} />
            </Field>
            <Field label="Until">
              <Options value={w.end} onChange={(v) => set(i, { end: v })} options={HOURS.map((h) => ({ value: h, label: h }))} />
            </Field>
            {windows.length > 1 && (
              <Button variant="ghost" onPress={() => setWindows(windows.filter((_, j) => j !== i))}>
                Remove this window
              </Button>
            )}
          </View>
        ))}
        <Button
          variant="secondary"
          onPress={() => setWindows([...windows, { weekday: 6, start: "11:00", end: "17:00" }])}
        >
          Add another window
        </Button>
      </Card>
      <Card>
        <Text style={s.h2}>What kind of first date suits you?</Text>
        <ChipGroup values={styles} onChange={setStyles} options={STYLES} />
      </Card>
      <Card>
        <Toggle
          value={ready}
          onValueChange={setReady}
          label="I'm ready to be introduced"
          description="Turn this off any time to pause introductions without losing your Blueprint."
        />
      </Card>
      <Button onPress={save} loading={busy} disabled={!styles.length || !windows.length}>
        {cta}
      </Button>
    </View>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkSecondary, marginBottom: space.md },
  window: { borderTopWidth: 1, borderTopColor: color.border, paddingTop: space.md, marginTop: space.md },
} as const;
