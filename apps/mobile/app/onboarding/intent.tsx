import { useState } from "react";
import { useRouter } from "expo-router";
import { Text } from "react-native";
import { ApiError, post } from "@/api/client";
import type { Me } from "@/api/types";
import { nextOnboardingPath, useAuth, useRequireMember } from "@/lib/auth";
import {
  Button,
  Card,
  ChipGroup,
  ErrorState,
  Field,
  Options,
  PageTitle,
  Screen,
  Steps,
  Stepper,
} from "@/components/ui";
import { color, space, type as typo } from "@/theme";

const CITIES = [
  {
    id: "rome",
    name: "Rome",
    zones: [
      ["rome:centro", "Centro Storico"],
      ["rome:prati", "Prati"],
      ["rome:trastevere", "Trastevere"],
      ["rome:monti", "Monti / Esquilino"],
      ["rome:parioli", "Parioli / Flaminio"],
      ["rome:san-giovanni", "San Giovanni / Appio"],
      ["rome:eur", "EUR"],
      ["rome:monteverde", "Monteverde"],
      ["rome:pigneto", "Pigneto / San Lorenzo"],
      ["rome:nomentano", "Nomentano / Trieste"],
      ["rome:ostia", "Ostia"],
    ] as [string, string][],
  },
  {
    id: "barcelona",
    name: "Barcelona",
    zones: [
      ["barcelona:eixample", "Eixample"],
      ["barcelona:gracia", "Gràcia"],
      ["barcelona:gotic", "Ciutat Vella"],
      ["barcelona:poblenou", "Poblenou"],
      ["barcelona:sants", "Sants"],
      ["barcelona:sarria", "Sarrià / Sant Gervasi"],
      ["barcelona:horta", "Horta / Guinardó"],
    ] as [string, string][],
  },
];

const GENDERS = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non_binary", label: "Non-binary" },
  { value: "other", label: "Another identity" },
];

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
  const [relocation, setRelocation] = useState("maybe");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const zones = CITIES.find((c) => c.id === city)?.zones ?? [];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post<Me>("/me/intent", {
        intent,
        home_city_id: city,
        home_zone_id: zone,
        gender,
        seeking,
        max_distance_km: distance,
        relocation_openness: relocation,
      });
      const m = await refresh();
      if (m) router.replace(nextOnboardingPath(m) as never);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Steps step={3} />
      <PageTitle
        eyebrow="Intent"
        title="Commit to a relationship lane"
        lede="The pilot serves one lane: people ready for a serious relationship. Your lane is visible to introductions; your zone is used only for coarse distance."
      />
      <ErrorState error={error} />
      <Card>
        <Text style={s.h2}>What I'm here for</Text>
        <Options
          value={intent}
          onChange={setIntent}
          options={[
            { value: "long_term", label: "A long-term relationship", body: "Exclusive, building toward something lasting." },
            { value: "life_partner", label: "A life partner", body: "Marriage-minded or equivalent commitment." },
          ]}
        />
        <Text style={s.note}>Casual-only intent is outside the pilot's promise.</Text>
      </Card>
      <Card>
        <Text style={s.h2}>About you (matching only)</Text>
        <Field label="I am a">
          <Options value={gender} onChange={setGender} options={GENDERS} />
        </Field>
        <Field label="I'd like to meet">
          <ChipGroup values={seeking} onChange={setSeeking} options={GENDERS} />
        </Field>
        <Text style={s.note}>Introductions are only made where both people's answers match each other.</Text>
      </Card>
      <Card>
        <Text style={s.h2}>Home city and zone</Text>
        <Field label="City">
          <Options
            value={city}
            onChange={(v) => {
              setCity(v);
              setZone("");
            }}
            options={CITIES.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Zone" help="A neighbourhood, not an address. Distances are shown as bands like 0–5 km.">
          <Options value={zone} onChange={setZone} options={zones.map(([v, l]) => ({ value: v, label: l }))} />
        </Field>
        <Field label="Realistic distance for regular dates">
          <Stepper value={distance} onChange={setDistance} min={1} max={200} step={5} suffix=" km" label="distance in kilometres" />
        </Field>
        <Field label="Would you relocate for the right relationship?">
          <Options
            value={relocation}
            onChange={setRelocation}
            options={[
              { value: "open", label: "Yes, I'm open to it" },
              { value: "maybe", label: "Maybe, for the right reasons" },
              { value: "no", label: "No, my life is here" },
            ]}
          />
        </Field>
      </Card>
      <Button onPress={submit} loading={busy} disabled={!gender || seeking.length === 0 || !zone}>
        Commit to this lane
      </Button>
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.sm },
  note: { ...typo.small, color: color.inkTertiary, marginTop: space.sm },
} as const;
