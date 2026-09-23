import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { ApiError, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import {
  Button,
  Card,
  ChipGroup,
  ErrorState,
  Field,
  Options,
  PageTitle,
  Screen,
  StatusBanner,
  Steps,
  Stepper,
  TextInput,
} from "@/components/ui";
import { color, space, type as typo } from "@/theme";

type Option = { value: string; label: string };
type Question = {
  key: string;
  phase: string;
  category: string;
  prompt: string;
  help: string;
  input: string;
  options: Option[];
  skippable: boolean;
  special_category: boolean;
  tier_choice: boolean;
  preference_key: string | null;
  preference_label: string | null;
  preference_options: Option[] | null;
  data_use: string;
};
type SessionState = {
  session_id: string;
  status: string;
  progress: number;
  next_question: Question | null;
  review_ready: boolean;
  estimated_minutes_remaining: number;
};

const TIERS = [
  { value: "must", label: "Must", body: "We never introduce anyone outside these answers." },
  { value: "prefer", label: "Prefer", body: "Weighed in your favour, but not a wall." },
  { value: "open", label: "Open", body: "Genuinely not a factor for you." },
];

/** O05 Adaptive Dating Blueprint: one scenario at a time, natural answers, skip, progress. */
export default function Interview() {
  useRequireMember({ allowOnboarding: true });
  const router = useRouter();
  const [state, setState] = useState<SessionState | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"choice" | "text">("choice");
  const [tier, setTier] = useState("prefer");
  const [partner, setPartner] = useState<string[]>([]);
  const [range, setRange] = useState({ min: 27, max: 42 });
  const [km, setKm] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    post<SessionState>("/blueprint/sessions", { mode: "initial" })
      .then(setState)
      .catch((e) => setError(e as ApiError));
  }, []);

  const q = state?.next_question ?? null;
  const qKey = q?.key;
  const qPreference = q?.preference_key;
  useEffect(() => {
    setChoice(null);
    setText("");
    setMode("choice");
    setPartner([]);
    if (qPreference) setTier(qKey === "children" || qKey === "relationship_structure" ? "must" : "prefer");
  }, [qKey, qPreference]);

  const submit = async (skip = false) => {
    if (!state || !q) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        question_key: q.key,
        skip,
        input_mode: mode === "text" ? "text" : "choice",
      };
      if (!skip) {
        if (q.input === "range") payload.range = range;
        else if (q.input === "number") payload.range = { value: km };
        else if (mode === "text") payload.text = text;
        else payload.choice = choice;
        if (q.preference_key) {
          payload.tier = tier;
          payload.partner_values = partner.length ? partner : choice ? [choice] : [];
        }
      }
      const next = await post<SessionState>(`/blueprint/sessions/${state.session_id}/answers`, payload);
      setState(next);
      if (!next.next_question)
        router.replace({ pathname: "/onboarding/blueprint-review", params: { session: state.session_id } } as never);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !q
    ? false
    : q.input === "range" || q.input === "number"
      ? true
      : mode === "text"
        ? text.trim().length >= 8
        : !!choice;

  return (
    <Screen>
      <Steps step={4} />
      <PageTitle
        eyebrow={q ? (q.phase === "non_negotiable" ? "Non-negotiables" : "Scenario") : "Dating Blueprint"}
        title={q ? q.prompt : "Building your Blueprint"}
        lede={q?.help}
      />
      <ErrorState error={error} retry={() => setError(null)} />
      {!!state && (
        <View style={s.progressRow}>
          <Text style={s.progressText}>
            {Math.round(state.progress * 100)}% · about {state.estimated_minutes_remaining} min left
          </Text>
          {!!q && (
            <Text style={s.dataUse}>
              {q.data_use === "matching_only" ? "Matching only" : "Sensitive · explicit consent"}
            </Text>
          )}
        </View>
      )}
      {!q && !error && <Card><Text style={{ ...typo.body, color: color.inkSecondary }}>Preparing your next question…</Text></Card>}
      {!!q && (
        <>
          {q.special_category && (
            <StatusBanner
              tone="caution"
              title="Optional sensitive question"
              body="Answer only if you want faith used for matching. Skipping is never held against you."
            />
          )}
          {(q.input === "choice" || q.input === "choice_or_text") && mode === "choice" && (
            <Options
              value={choice ?? ""}
              onChange={setChoice}
              options={q.options.map((o) => ({ value: o.value, label: o.label }))}
            />
          )}
          {q.input === "choice_or_text" && (
            <View style={{ marginBottom: space.md }}>
              {mode === "choice" ? (
                <Button variant="ghost" fullWidth={false} onPress={() => setMode("text")}>
                  Answer in my own words
                </Button>
              ) : (
                <Card>
                  <Field
                    label="In your own words"
                    help="AI turns this into signals you'll confirm. Say as much or as little as you like."
                  >
                    <TextInput
                      value={text}
                      onChangeText={setText}
                      multiline
                      numberOfLines={4}
                      style={{ minHeight: 110, textAlignVertical: "top" }}
                      accessibilityLabel="Your answer in your own words"
                    />
                  </Field>
                  <Button variant="ghost" onPress={() => setMode("choice")}>
                    Choose an option instead
                  </Button>
                </Card>
              )}
            </View>
          )}
          {q.input === "range" && (
            <Card>
              <Field label="From">
                <Stepper value={range.min} onChange={(v) => setRange({ ...range, min: v })} min={18} max={99} label="minimum age" />
              </Field>
              <Field label="To">
                <Stepper value={range.max} onChange={(v) => setRange({ ...range, max: v })} min={18} max={99} label="maximum age" />
              </Field>
            </Card>
          )}
          {q.input === "number" && (
            <Card>
              <Field label="Kilometres">
                <Stepper value={km} onChange={setKm} min={1} max={200} step={5} suffix=" km" label="kilometres" />
              </Field>
            </Card>
          )}
          {!!q.preference_key && !!q.preference_options && (
            <Card>
              <Text style={s.h2}>In a partner: {q.preference_label}</Text>
              <Text style={s.note}>Which answers could you build a life with? Then decide how hard this is.</Text>
              <ChipGroup
                values={partner}
                onChange={setPartner}
                options={q.preference_options.map((o) => ({ value: o.value, label: o.label }))}
              />
              {q.tier_choice && <Options value={tier} onChange={setTier} options={TIERS} />}
              {tier === "must" && (
                <Text style={s.note}>
                  Must means we never introduce anyone outside these answers, and we never relax it for you.
                </Text>
              )}
            </Card>
          )}
          {(q.input === "range" || q.input === "number") && (
            <Card>
              <Text style={s.h2}>How hard is this?</Text>
              <Options value={tier} onChange={setTier} options={TIERS} />
            </Card>
          )}
          <Button onPress={() => submit(false)} loading={busy} disabled={!canSubmit}>
            {q.phase === "non_negotiable" ? "Save and continue" : "That's me"}
          </Button>
          {q.skippable && (
            <Button variant="ghost" onPress={() => submit(true)} disabled={busy}>
              Skip this question
            </Button>
          )}
        </>
      )}
    </Screen>
  );
}

const s = {
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.md },
  progressText: { ...typo.small, color: color.inkSecondary },
  dataUse: { ...typo.caption, color: color.inkSecondary, backgroundColor: color.surfaceMuted, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: "hidden" },
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkTertiary, marginBottom: space.sm },
} as const;
