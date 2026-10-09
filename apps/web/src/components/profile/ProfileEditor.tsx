"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { LANG_LABEL } from "@/lib/format";
import { Button, Card, ErrorState, Field, MediaImage, Select, Skeleton, TextArea, TextInput } from "@/components/ui";

type Media = { id: string; type: string; position: number; alt_text: string | null; moderation_status: string; upload_state: string; url: string | null };
type Profile = { display_name: string | null; pronouns: string | null; occupation: string | null; bio: string | null; languages: string[]; prompts: { key: string; answer: string }[]; available_prompts: { key: string; label: string }[]; media: Media[]; completeness: number; version: number; visibility_map: Record<string, string> };


/**
 * Exactly what `POST /profile/media/{id}/complete` accepts — `PHOTO_TYPES` and `VOICE_TYPES` in
 * app/core/datauri.py, the two lists `complete_media` passes to `decode_data_url`, compared with
 * these by `tools/check_upload_types.py` in CI.
 *
 * `image/*` would invite a file the server then refuses — and would have to include SVG, which is
 * markup an `<img>` renders, so neither side can be a wildcard.
 */
const PHOTO_ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"].join(",");
const VOICE_ACCEPT = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/x-m4a"].join(",");

export function ProfileEditor({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => get<Profile>("/profile") });
  const [form, setForm] = useState<Partial<Profile>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile.data && !form.version) setForm({ display_name: profile.data.display_name ?? "", pronouns: profile.data.pronouns ?? "", occupation: profile.data.occupation ?? "", bio: profile.data.bio ?? "", languages: profile.data.languages, prompts: profile.data.prompts.length ? profile.data.prompts : [{ key: "second_date", answer: "" }, { key: "ordinary_tuesday", answer: "" }], version: profile.data.version });
  }, [profile.data, form.version]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await patch<Profile>("/profile", { ...form, prompts: (form.prompts ?? []).filter((p) => p.answer.trim()) });
      qc.setQueryData(["profile"], next);
      setForm((f) => ({ ...f, version: next.version }));
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File, type: "photo" | "voice") => {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await toDataUrl(file);
      const created = await post<{ media: Media }>("/profile/media", { type, content_type: file.type, size_bytes: file.size, checksum: null, alt_text: type === "photo" ? "Profile photo" : "Voice note" });
      await post(`/profile/media/${created.media.id}/complete`, { data_url: dataUrl });
      await qc.invalidateQueries({ queryKey: ["profile"] });
      onSaved?.();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (!profile.data) return <Skeleton lines={6} />;
  const p = profile.data;
  return (
    <div>
      <ErrorState error={error} />
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Photos</h2>
          <span className="text-sm text-ink-secondary">{p.completeness}% complete</span>
        </div>
        <ul className="mb-3 grid grid-cols-3 gap-2">
          {p.media
            .filter((m) => m.type === "photo")
            .map((m) => (
              <li key={m.id} className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] bg-surface-muted">
                {m.url && <MediaImage url={m.url} alt={m.alt_text ?? "Profile photo"} />}
                <span className="absolute left-1 top-1 rounded bg-surface/90 px-1.5 text-xs">{m.moderation_status === "approved" ? "Live" : "In review"}</span>
                <button type="button" aria-label="Remove photo" className="absolute right-1 top-1 rounded-full bg-surface/90 px-2 text-sm" onClick={() => del(`/profile/media/${m.id}`).then(() => qc.invalidateQueries({ queryKey: ["profile"] }))}>
                  ✕
                </button>
              </li>
            ))}
        </ul>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 font-semibold">
          {/* Labelled explicitly, so nothing has to identify this input by its `accept` list. An e2e
              selector keyed on `accept="image/*"` is what broke when the list was enumerated to
              match the server, and a hidden input that only a wrapping label names is thin for a
              screen reader anyway. */}
          <input type="file" aria-label="Add a photo" accept={PHOTO_ACCEPT} className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "photo")} />
          + Add a photo
        </label>
        <p className="mt-2 text-xs text-ink-tertiary">Public. Reviewed before publishing. Up to six. Recent and recognisably you.</p>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-3 font-bold">Voice note (optional)</h2>
        {p.media.some((m) => m.type === "voice") ? <p className="text-sm text-success">Voice note added ✓</p> : <p className="mb-2 text-sm text-ink-secondary">Thirty seconds of you: an answer to “what makes a good Sunday?”</p>}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 font-semibold">
          <input type="file" aria-label="Add a voice note" accept={VOICE_ACCEPT} className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "voice")} />
          🎤 Upload a voice note
        </label>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-3 font-bold">Facts</h2>
        <Field label="Display name" htmlFor="name" help="Public. First name or nickname.">
          <TextInput id="name" value={form.display_name ?? ""} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={60} />
        </Field>
        <Field label="Pronouns (optional)" htmlFor="pronouns">
          <TextInput id="pronouns" value={form.pronouns ?? ""} onChange={(e) => setForm({ ...form, pronouns: e.target.value })} maxLength={32} />
        </Field>
        <Field label="What you do" htmlFor="occupation">
          <TextInput id="occupation" value={form.occupation ?? ""} onChange={(e) => setForm({ ...form, occupation: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Languages you'd date in" htmlFor="languages" help="Public. Translation is offered for EN, IT, ES and PT.">
          <div className="flex flex-wrap gap-2">
            {Object.entries(LANG_LABEL).map(([v, l]) => {
              const on = (form.languages ?? []).includes(v);
              return (
                <button key={v} type="button" aria-pressed={on} onClick={() => setForm({ ...form, languages: on ? (form.languages ?? []).filter((x) => x !== v) : [...(form.languages ?? []), v] })} className={`rounded-full border px-3 py-2 text-sm font-semibold ${on ? "border-action bg-action-soft text-action" : "border-border bg-surface text-ink-secondary"}`}>
                  {l}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="About you" htmlFor="bio" help="Public. What a good week looks like, what you're building toward.">
          <TextArea id="bio" rows={4} maxLength={600} value={form.bio ?? ""} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-1 font-bold">Prompts</h2>
        <p className="mb-3 text-sm text-ink-secondary">Public. Up to three. These give introductions something real to respond to before photos take over.</p>
        {(form.prompts ?? []).map((pr, i) => (
          <div key={i} className="mb-3">
            <Select aria-label="Prompt" value={pr.key} onChange={(e) => setForm({ ...form, prompts: (form.prompts ?? []).map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })}>
              {p.available_prompts.map((ap) => (
                <option key={ap.key} value={ap.key}>
                  {ap.label}…
                </option>
              ))}
            </Select>
            <TextArea className="mt-2" rows={2} maxLength={240} aria-label="Prompt answer" value={pr.answer} onChange={(e) => setForm({ ...form, prompts: (form.prompts ?? []).map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) })} />
          </div>
        ))}
        {(form.prompts ?? []).length < 3 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, prompts: [...(form.prompts ?? []), { key: p.available_prompts[(form.prompts ?? []).length]?.key ?? "learned_recently", answer: "" }] })}>
            + Add a prompt
          </Button>
        )}
      </Card>
      <Button fullWidth loading={busy} onClick={save}>
        {saved ? "Saved ✓" : "Save my profile"}
      </Button>
    </div>
  );
}

function toDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
