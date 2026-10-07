import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Alert, Text, View } from "react-native";
import { ApiError, post } from "@/api/client";
import { Button, Card, ErrorState, Field, StatusBanner, TextInput } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * `EvidenceIn.data_url` is capped at 15,000,000 characters
 * (apps/api/app/modules/safety/router.py), and base64 is four characters per three bytes, so
 * anything over about 11 MB is refused. A screenshot is comfortably under that; a photo
 * straight off a flagship camera often is not, and "Take a photo" is one of the two buttons
 * here. Unshrunk, those came back as a generic validation error on a safety path.
 */
const DATA_URL_LIMIT = 15_000_000;

/**
 * Tried in order, only when the original does not fit. 2400px keeps the text in a screenshot
 * of a message legible, which is what most of this evidence is.
 *
 * Ceilings, not targets — and the distinction is the whole of `shrinkSteps` below. `resize({
 * width })` sets the *result* width (expo-image-manipulator's own types: "Values correspond to
 * the result image dimensions"), so a step wider than the source enlarges the image instead of
 * shrinking it.
 */
const SHRINK_CEILINGS = [
  { width: 2400, compress: 0.8 },
  { width: 1600, compress: 0.7 },
  { width: 1200, compress: 0.6 },
];

/** Below this a screenshot of a message stops being readable, so there is no point going on. */
const MIN_WIDTH = 240;

/**
 * The widths actually worth asking for, given what the source is.
 *
 * A long chat screenshot — the commonest evidence on this screen — is often under 1200px wide
 * and thousands tall, so every one of the ceilings above was *larger* than its width: all three
 * steps enlarged it, it never got under the cap, and the member was told their image was too
 * large to attach even though downscaling it would have worked.
 *
 * So the ceilings are filtered to those that genuinely reduce the width, and where that leaves
 * nothing much to try, fractions of the source take over.
 */
export function shrinkSteps(sourceWidth: number | undefined): { width: number; compress: number }[] {
  // An asset with no width reported: nothing to reason from, so keep the ceilings as they are.
  if (!sourceWidth || sourceWidth <= 0) return [...SHRINK_CEILINGS];

  const steps = SHRINK_CEILINGS.filter((s) => s.width < sourceWidth);
  if (steps.length >= 2) return steps;

  for (const [scale, compress] of [
    [0.5, 0.7],
    [0.33, 0.6],
    [0.25, 0.5],
  ] as const) {
    const width = Math.round(sourceWidth * scale);
    if (width < MIN_WIDTH || width >= sourceWidth) continue;
    if (steps.some((s) => s.width === width)) continue;
    steps.push({ width, compress });
  }
  return steps.sort((a, b) => b.width - a.width);
}

const hasApiBody = (e: unknown): boolean =>
  typeof e === "object" && e !== null && typeof (e as { body?: { message?: unknown } }).body?.message === "string";

const dataUrl = (contentType: string, base64: string) => `data:${contentType};base64,${base64}`;

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

  /**
   * Everything from the permission prompt onwards is inside the guard.
   *
   * The permission request and the picker launch used to sit outside it, and the button discards
   * this promise with `void` — so an OS-level rejection or a camera that is unavailable became an
   * unhandled rejection, and the member saw nothing at all. On the screen somebody uses to attach
   * evidence of being harassed, silence is the worst available outcome.
   */
  const attach = async (from: "library" | "camera") => {
    setError(null);
    setBusy(true);
    try {
      await pick(from);
    } catch (e) {
      // Duck-typed rather than `instanceof`: anything carrying a server body already has a message
      // written for the member, and losing it to a prototype check would replace a precise
      // explanation with a generic one.
      setError(
        hasApiBody(e)
          ? (e as ApiError)
          : new ApiError(0, {
              code: "PICKER_FAILED",
              message:
                from === "camera"
                  ? "The camera could not be opened. Choosing an existing screenshot usually works."
                  : "Your photos could not be opened. You can still send the report without an image.",
            }),
      );
    } finally {
      setBusy(false);
    }
  };

  const pick = async (from: "library" | "camera") => {
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
    // No cropping, and no `quality`: evidence should reach the reviewer as the member has it,
    // and an editor in the middle of this flow is one more thing to get through on a bad day.
    //
    // `quality` defaults to 1.0 and anything lower asks the picker to recompress. Passing 0.9
    // — carried over from the profile photo flow, where a crop is re-encoded anyway — meant
    // every screenshot was softened on the way in, including the ones small enough to send
    // untouched. Compression now happens only in fitForUpload, only when it has to.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], base64: true };
    const res =
      from === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    if (!asset.base64) {
      throw new ApiError(0, { code: "UPLOAD_FAILED", message: "That image could not be read. Try another one." });
    }
    const prepared = await fitForUpload(asset, asset.base64);
    if (!prepared) {
      throw new ApiError(0, {
        code: "TOO_LARGE",
        message:
          "That image is too large to attach, even after shrinking it. A screenshot of the same thing will usually go through.",
      });
    }
    await post(`/safety/reports/${reportId}/evidence`, {
      content_type: prepared.contentType,
      size_bytes: Math.round((prepared.base64.length * 3) / 4),
      checksum: null,
      description: description.trim() || null,
      data_url: dataUrl(prepared.contentType, prepared.base64),
    });
    setDescription("");
    setAdded((n) => n + 1);
    await Promise.all([qc.invalidateQueries({ queryKey: ["safety-case", reportId] }), onAdded?.()]);
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

/**
 * The image as the API will accept it, or null when even the smallest step is too big.
 *
 * An image that already fits is sent untouched — re-encoding a clean PNG screenshot as JPEG
 * for no reason would soften the text a reviewer needs to read. Shrinking happens only when
 * the alternative is not sending it at all.
 */
async function fitForUpload(
  asset: ImagePicker.ImagePickerAsset,
  base64: string,
): Promise<{ contentType: string; base64: string } | null> {
  const original = asset.mimeType ?? "image/jpeg";
  if (dataUrl(original, base64).length <= DATA_URL_LIMIT) {
    return { contentType: original, base64 };
  }
  for (const step of shrinkSteps(asset.width)) {
    // The contextual API; manipulateAsync is deprecated in this SDK.
    const rendered = await ImageManipulator.manipulate(asset.uri).resize({ width: step.width }).renderAsync();
    const out = await rendered.saveAsync({ base64: true, compress: step.compress, format: SaveFormat.JPEG });
    if (out.base64 && dataUrl("image/jpeg", out.base64).length <= DATA_URL_LIMIT) {
      return { contentType: "image/jpeg", base64: out.base64 };
    }
  }
  return null;
}

const s = {
  h2: { ...typo.title, color: color.ink, marginBottom: space.xs },
  note: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
  row: { flexDirection: "row", gap: space.sm },
  half: { flex: 1 },
} as const;
