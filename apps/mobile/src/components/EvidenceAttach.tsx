import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Alert, Text, View } from "react-native";
import { ApiError, post } from "@/api/client";
import { Button, Card, ErrorState, Field, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * S02/S03 evidence. A screenshot is often the whole report — a threatening message, a demand
 * for money, a profile that is plainly someone else. The web app has had this since launch;
 * on mobile the member could describe the screenshot in the narrative but never send it, and
 * the screenshot is on the phone, which is the one place this endpoint was unreachable from.
 *
 * Mirrors the profile upload contract: base64 read, sent as a data URL. The permission is
 * requested at the tap, not on launch.
 */
export function EvidenceAttach({ reportId, onAdded }: { reportId: string; onAdded?: () => void | Promise<unknown> }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [added, setAdded] = useState(0);

  const attach = async (from: "library" | "camera") => {
    setError(null);
    const perm =
      from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        from === "camera"
          ? "Allow camera access to photograph something for your report. You can change this in Settings."
          : "Allow photo access to attach a screenshot to your report. You can change this in Settings.",
      );
      return;
    }
    // No cropping: evidence should reach the reviewer as the member has it, and an editor in
    // the middle of this flow is one more thing to get through on a bad day.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.9, base64: true };
    const res =
      from === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    if (!asset.base64) {
      setError(new ApiError(0, { code: "UPLOAD_FAILED", message: "That image could not be read. Try another one." }));
      return;
    }
    const contentType = asset.mimeType ?? "image/jpeg";
    setBusy(true);
    try {
      await post(`/safety/reports/${reportId}/evidence`, {
        content_type: contentType,
        size_bytes: asset.fileSize ?? Math.round((asset.base64.length * 3) / 4),
        checksum: null,
        description: description.trim() || null,
        data_url: `data:${contentType};base64,${asset.base64}`,
      });
      setDescription("");
      setAdded((n) => n + 1);
      await Promise.all([qc.invalidateQueries({ queryKey: ["safety-case", reportId] }), onAdded?.()]);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={s.h2}>Attach a screenshot</Text>
      <Text style={s.note}>
        Only the reviewer handling your case can open it, every access is logged, and it is never shown to the person
        you reported.
      </Text>
      <ErrorState error={error} />
      {added > 0 && (
        <StatusBanner
          tone="success"
          title={added === 1 ? "Attached" : `${added} attached`}
          body="The reviewer will see it with your case."
        />
      )}
      <Field label="What does it show?" help="Optional, and helpful. One line is enough.">
        <TextInput value={description} onChangeText={setDescription} maxLength={300} />
      </Field>
      <View style={s.row}>
        <View style={s.half}>
          <Button variant="secondary" loading={busy} onPress={() => void attach("library")}>
            Choose a screenshot
          </Button>
        </View>
        <View style={s.half}>
          <Button variant="ghost" loading={busy} onPress={() => void attach("camera")}>
            Take a photo
          </Button>
        </View>
      </View>
    </Card>
  );
}

const s = {
  h2: { ...typo.title, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
  row: { flexDirection: "row", gap: space.sm },
  half: { flex: 1 },
} as const;
