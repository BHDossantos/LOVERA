"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, post } from "@/lib/api";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import { OnboardingShell } from "@/components/shell/AppShell";
import { Button, Card, ChoiceCard, ErrorState, Field, PageTitle, Select, TextInput } from "@/components/ui";
import type { Me } from "@/lib/types";

const CITIES = [
  { id: "rome", name: "Rome", zones: [["rome:centro", "Centro Storico"], ["rome:prati", "Prati"], ["rome:trastevere", "Trastevere"], ["rome:monti", "Monti / Esquilino"], ["rome:parioli", "Parioli / Flaminio"], ["rome:san-giovanni", "San Giovanni / Appio"], ["rome:eur", "EUR"], ["rome:monteverde", "Monteverde"], ["rome:pigneto", "Pigneto / San Lorenzo"], ["rome:nomentano", "Nomentano / Trieste"], ["rome:ostia", "Ostia"]] },
  { id: "barcelona", name: "Barcelona", zones: [["barcelona:eixample", "Eixample"], ["barcelona:gracia", "Gràcia"], ["barcelona:gotic", "Ciutat Vella"], ["barcelona:poblenou", "Poblenou"], ["barcelona:sants", "Sants"], ["barcelona:sarria", "Sarrià / Sant Gervasi"], ["barcelona:horta", "Horta / Guinardó"]] },
];
const GENDERS = [["woman", "Woman"], ["man", "Man"], ["non_binary", "Non-binary"], ["other", "Another identity"]];

/** O04 Intent & home city: relationship lane, coarse zone, distance, relocation openness. */
export default function Intent() {
  const { me } = useRequireMember({ allowOnboarding: true });
  const { refresh } = useAuth();
  const router = useRouter();
  const [intent, setIntent] = useState(me?.intent ?? "long_term");
  const [city, setCity] = useState(me?.home_city_id ?? "rome");
  const [zone, setZone] = useState(me?.home_zone_id ?? "");
  const [gender, setGender] = useState(me?.gender ?? "");
  const [seeking, setSeeking] = useState<string[]>(me?.seeking ?? []);
  const [distance, setDistance] = useState(me?.max_distance_km ?? 25);
  const [relocation, setRelocation] = useState<string>("maybe");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const zones = CITIES.find((c) => c.id === city)?.zones ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post<Me>("/me/intent", { intent, home_city_id: city, home_zone_id: zone, gender, seeking, max_distance_km: distance, relocation_openness: relocation });
      const m = await refresh();
      if (m) router.replace(nextOnboardingPath(m));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingShell step={3}>
      <PageTitle eyebrow="Intent" title="Commit to a relationship lane" lede="The pilot serves one lane: people ready for a serious relationship. Your lane is visible to introductions; your zone is used only for coarse distance." />
      <ErrorState error={error} />
      <form onSubmit={submit}>
        <Card className="mb-4">
          <h2 className="mb-2 font-bold">What I'm here for</h2>
          <div role="radiogroup" className="space-y-2">
            <ChoiceCard title="A long-term relationship" body="Exclusive, building toward something lasting." selected={intent === "long_term"} onSelect={() => setIntent("long_term")} />
            <ChoiceCard title="A life partner" body="Marriage-minded or equivalent commitment." selected={intent === "life_partner"} onSelect={() => setIntent("life_partner")} />
          </div>
          <p className="mt-2 text-sm text-ink-tertiary">Casual-only intent is outside the pilot's promise.</p>
        </Card>
        <Card className="mb-4">
          <h2 className="mb-2 font-bold">About you (matching only)</h2>
          <Field label="I am a" htmlFor="gender">
            <Select id="gender" required value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Choose…</option>
              {GENDERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="mb-2">
            <legend className="mb-1 text-sm font-semibold">I'd like to meet</legend>
            <div className="flex flex-wrap gap-2">
              {GENDERS.map(([v, l]) => {
                const on = seeking.includes(v);
                return (
                  <button key={v} type="button" aria-pressed={on} onClick={() => setSeeking(on ? seeking.filter((s) => s !== v) : [...seeking, v])} className={`rounded-full border px-4 py-2 text-sm font-semibold ${on ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary"}`}>
                    {l}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p className="text-sm text-ink-tertiary">Introductions are only made where both people's answers match each other.</p>
        </Card>
        <Card className="mb-6">
          <h2 className="mb-2 font-bold">Home city and zone</h2>
          <Field label="City" htmlFor="city">
            <Select id="city" value={city} onChange={(e) => { setCity(e.target.value); setZone(""); }}>
              {CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zone" htmlFor="zone" help="A neighbourhood, not an address. Distances are shown as bands like 0–5 km.">
            <Select id="zone" required value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="">Choose…</option>
              {zones.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Realistic distance for regular dates (km)" htmlFor="distance">
            <TextInput id="distance" type="number" min={1} max={200} value={distance} onChange={(e) => setDistance(Number(e.target.value))} />
          </Field>
          <Field label="Would you relocate for the right relationship?" htmlFor="relocation">
            <Select id="relocation" value={relocation} onChange={(e) => setRelocation(e.target.value)}>
              <option value="open">Yes, I'm open to it</option>
              <option value="maybe">Maybe, for the right reasons</option>
              <option value="no">No, my life is here</option>
            </Select>
          </Field>
        </Card>
        <Button type="submit" fullWidth loading={busy} disabled={!gender || seeking.length === 0 || !zone}>
          Commit to this lane
        </Button>
      </form>
    </OnboardingShell>
  );
}
