import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get, post } from "@/api/client";
import type { Blueprint, BlueprintSignal, CorrectionResult } from "@/api/types";
import { Button, Card, ErrorState, Field, Options, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * I02/I03 "Something wrong?".
 *
 * The explanation names the assumptions the match was made on. Showing those without a way
 * to correct them is the worst of both worlds: the member now knows the matcher is wrong
 * about them and can do nothing about it. A correction is recorded against the introduction
 * and, when a value is chosen, written to the member's own Blueprint through the versioned
 * path, which marks the signal member-corrected so a later inference cannot quietly undo it.
 *
 * It is never shown to the other member, and it does not change this introduction's decision.
 */
export function CorrectionForm({ introId, suggestedKeys = [] }: { introId: string; suggestedKeys?: string[] }) {
  const qc = useQueryClient();
  const blueprint = useQuery({ queryKey: ["blueprint"], queryFn: () => get<Blueprint>("/blueprint/current") });
  const [open, setOpen] = useState(false);
  const [signalKey, setSignalKey] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<CorrectionResult | null>(null);

  // Signals the explanation itself flagged as unknown come first: they are the ones the
  // matcher guessed at, so they are the likeliest to be wrong.
  const ordered = useMemo(() => {
    const all: BlueprintSignal[] = blueprint.data?.signals ?? [];
    return [...all.filter((s) => suggestedKeys.includes(s.key)), ...all.filter((s) => !suggestedKeys.includes(s.key))];
  }, [blueprint.data, suggestedKeys]);
  const active = ordered.find((s) => s.key === signalKey) ?? null;

  const submit = async () => {
    if (!signalKey) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<CorrectionResult>(`/introductions/${introId}/correction`, {
        signal_key: signalKey,
        value: value || null,
        note: note.trim() || null,
      });
      setResult(r);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["introduction", introId] }),
        qc.invalidateQueries({ queryKey: ["blueprint"] }),
      ]);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (result)
    return (
      <Card>
        <StatusBanner tone="success" title="Correction recorded" body={result.message} />
      </Card>
    );

  return (
    <Card>
      <Text style={s.h2}>Something wrong?</Text>
      <Text style={s.note}>
        If an assumption about you is off, correct it here. It updates your own Blueprint only, and is never shown
        to the other person.
      </Text>
      {!open ? (
        <Button variant="ghost" onPress={() => setOpen(true)}>
          Correct something about me
        </Button>
      ) : (
        <>
          <ErrorState error={error} />
          <ErrorState error={(blueprint.error as ApiError) ?? null} retry={() => blueprint.refetch()} />
          <Field
            label="Which one is wrong?"
            help={suggestedKeys.length ? "The ones the matchmaker was unsure about are first." : undefined}
          >
            <Options
              value={signalKey}
              onChange={(k) => {
                setSignalKey(k);
                setValue("");
              }}
              options={ordered.map((sig) => ({
                value: sig.key,
                label: sig.label,
                body: sig.value_label ? `Currently: ${sig.value_label}` : "Not set",
              }))}
            />
          </Field>
          {!!active && (
            <Field
              label="What's right"
              help={
                active.special_category
                  ? "This is a sensitive category. It is only ever used because you declared it, never inferred."
                  : "Optional. Leave it as 'just flag it' to tell us it's wrong without picking a value."
              }
            >
              <Options
                value={value}
                onChange={setValue}
                options={[
                  { value: "", label: "Just flag it as wrong" },
                  ...active.options.map((o) => ({ value: o.value, label: o.label })),
                ]}
              />
            </Field>
          )}
          <Field label="Anything to add" help={`${note.length}/300`}>
            <TextInput value={note} onChangeText={setNote} multiline numberOfLines={2} maxLength={300} />
          </Field>
          <Button variant="secondary" loading={busy} disabled={!signalKey} onPress={submit}>
            Correct my Blueprint
          </Button>
        </>
      )}
    </Card>
  );
}

const s = {
  h2: { ...typo.title, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
} as const;
