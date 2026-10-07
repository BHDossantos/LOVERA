import { useEffect, useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { ApiError, del, get, patch, post } from "@/api/client";
import { Badge, Button, Card, ErrorState, Field, Loading, TextInput } from "@/components/ui";
import { color, radius, space, type as typo } from "@/theme";

type Media = { id: string; type: string; url: string | null; state?: string; alt_text?: string | null };
type Profile = {
  display_name: string | null;
  pronouns: string | null;
  occupation: string | null;
  bio: string | null;
  languages: string[];
  prompts: { key: string; answer: string }[];
  available_prompts: { key: string; label: string }[];
  media: Media[];
  completeness: number;
  version: number;
  visibility_map: Record<string, string>;
};

const LANGUAGES = ["English", "Italian", "Spanish", "French", "German", "Portuguese"];

export function ProfileEditor({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => get<Profile>("/profile") });
  const [form, setForm] = useState<Partial<Profile>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile.data && !form.version) {
      setForm({
        display_name: profile.data.display_name ?? "",
        pronouns: profile.data.pronouns ?? "",
        occupation: profile.data.occupation ?? "",
        bio: profile.data.bio ?? "",
        languages: profile.data.languages,
        prompts: profile.data.prompts.length
          ? profile.data.prompts
          : [
              { key: "second_date", answer: "" },
              { key: "ordinary_tuesday", answer: "" },
            ],
        version: profile.data.version,
      });
    }
  }, [profile.data, form.version]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await patch<Profile>("/profile", {
        ...form,
        prompts: (form.prompts ?? []).filter((p) => p.answer.trim()),
      });
      qc.setQueryData(["profile"], next);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Photos are read as base64 and sent as a data URL, matching the web upload contract.
   * We ask for the permission at the moment the member taps "Add a photo" rather than on
   * launch: a permission prompt with no context in front of it is the one people deny.
   */
  const addPhoto = async (from: "library" | "camera") => {
    setError(null);
    const perm =
      from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        from === "camera"
          ? "Allow camera access to take a profile photo. You can change this in Settings."
          : "Allow photo access to choose a profile photo. You can change this in Settings.",
      );
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.8,
      base64: true,
    };
    const res =
      from === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    if (!asset.base64) {
      setError(new ApiError(0, { code: "UPLOAD_FAILED", message: "That photo could not be read. Try another one." }));
      return;
    }
    const contentType = asset.mimeType ?? "image/jpeg";
    setUploading(true);
    try {
      const created = await post<{ media: Media }>("/profile/media", {
        type: "photo",
        content_type: contentType,
        size_bytes: asset.fileSize ?? Math.round((asset.base64.length * 3) / 4),
        checksum: null,
        alt_text: "Profile photo",
      });
      await post(`/profile/media/${created.media.id}/complete`, {
        data_url: `data:${contentType};base64,${asset.base64}`,
      });
      await qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setUploading(false);
    }
  };

  if (!profile.data) return <Loading label="Loading your profile" />;

  const media = profile.data.media ?? [];
  return (
    <View>
      <ErrorState error={error} />
      <Card>
        <Text style={s.h2}>Photos</Text>
        <Text style={s.note}>
          A few real, recent photos. Moderation checks them before anyone sees them; nothing is scored for looks.
        </Text>
        <View style={s.grid}>
          {media.map((m) => (
            <View key={m.id} style={s.thumbWrap}>
              {m.url ? (
                <Image source={{ uri: m.url }} style={s.thumb} accessibilityLabel={m.alt_text ?? "Profile photo"} />
              ) : (
                <View style={[s.thumb, s.thumbEmpty]} />
              )}
              {!!m.state && m.state !== "approved" && (
                <View style={s.thumbBadge}>
                  <Badge label={m.state === "pending" ? "In review" : m.state} tone="muted" />
                </View>
              )}
              {/* A photo you cannot take down is a photo you did not really choose to post. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove this photo"
                hitSlop={8}
                style={s.thumbRemove}
                onPress={() =>
                  Alert.alert("Remove this photo?", "It stops being visible to anyone straight away.", [
                    { text: "Keep it", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () => {
                        setError(null);
                        void del(`/profile/media/${m.id}`)
                          .then(() => qc.invalidateQueries({ queryKey: ["profile"] }))
                          .catch((e) => setError(e as ApiError));
                      },
                    },
                  ])
                }
              >
                <Text style={s.thumbRemoveText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <Button variant="secondary" onPress={() => addPhoto("library")} loading={uploading}>
          Choose from library
        </Button>
        <Button variant="ghost" onPress={() => addPhoto("camera")} disabled={uploading}>
          Take a photo
        </Button>
      </Card>
      <Card>
        <Field label="Display name">
          <TextInput
            value={form.display_name ?? ""}
            onChangeText={(v) => setForm({ ...form, display_name: v })}
            accessibilityLabel="Display name"
            autoCapitalize="words"
          />
        </Field>
        <Field label="Pronouns">
          <TextInput
            value={form.pronouns ?? ""}
            onChangeText={(v) => setForm({ ...form, pronouns: v })}
            placeholder="she/her, he/him, they/them…"
            accessibilityLabel="Pronouns"
            autoCapitalize="none"
          />
        </Field>
        <Field label="Occupation">
          <TextInput
            value={form.occupation ?? ""}
            onChangeText={(v) => setForm({ ...form, occupation: v })}
            accessibilityLabel="Occupation"
          />
        </Field>
        <Field label="About you" help="What an ordinary week with you actually looks like.">
          <TextInput
            value={form.bio ?? ""}
            onChangeText={(v) => setForm({ ...form, bio: v })}
            multiline
            numberOfLines={4}
            style={{ minHeight: 110, textAlignVertical: "top" }}
            accessibilityLabel="About you"
          />
        </Field>
        <Field label="Languages you speak">
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {LANGUAGES.map((l) => {
              const on = (form.languages ?? []).includes(l);
              return (
                <Pressable
                  key={l}
                  onPress={() =>
                    setForm({
                      ...form,
                      languages: on
                        ? (form.languages ?? []).filter((x) => x !== l)
                        : [...(form.languages ?? []), l],
                    })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[s.chip, on && { borderColor: color.action, backgroundColor: color.actionSoft }]}
                >
                  <Text style={[s.chipLabel, on && { color: color.action }]}>{l}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
      </Card>
      <Card>
        <Text style={s.h2}>In your own words</Text>
        {(form.prompts ?? []).map((p, i) => {
          const label = profile.data.available_prompts.find((a) => a.key === p.key)?.label ?? p.key;
          return (
            <Field key={p.key} label={label}>
              <TextInput
                value={p.answer}
                onChangeText={(v) =>
                  setForm({
                    ...form,
                    prompts: (form.prompts ?? []).map((x, j) => (j === i ? { ...x, answer: v } : x)),
                  })
                }
                multiline
                numberOfLines={3}
                style={{ minHeight: 88, textAlignVertical: "top" }}
                accessibilityLabel={label}
              />
            </Field>
          );
        })}
      </Card>
      <Button onPress={save} loading={busy}>
        {saved ? "Saved" : "Save my profile"}
      </Button>
    </View>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkSecondary, marginBottom: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md },
  thumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbRemoveText: { color: "#fff", fontSize: 18, lineHeight: 20, fontWeight: "700" },
  thumbWrap: { position: "relative" },
  thumb: { width: 96, height: 120, borderRadius: radius.md, backgroundColor: color.surfaceMuted },
  thumbEmpty: { borderWidth: 1, borderColor: color.border },
  thumbBadge: { position: "absolute", bottom: 4, left: 4 },
  chip: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: space.lg,
    marginRight: space.sm,
    marginBottom: space.sm,
  },
  chipLabel: { ...typo.small, fontWeight: "700", color: color.inkSecondary },
} as const;
