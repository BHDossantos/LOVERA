import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/**
 * Making a picked image small enough for the API to take, shared by every screen that uploads one.
 *
 * It lived inside the evidence attachment, which is where the problem was first noticed: a
 * screenshot off a recent phone does not fit, and unshrunk it came back as a generic validation
 * error on a safety report. The profile photo flow has exactly the same picker and the same
 * endpoint limit and did none of this — it relied on cropping to 4:5 and re-encoding at 0.8
 * quality to stay under, which holds for a 12-megapixel camera and does not for a 50- or
 * 200-megapixel one. So the member with the newest phone was the one who could not add a photo.
 */

/**
 * What the server will take, in bytes of actual file: `MAX_UPLOAD_BYTES` in
 * `apps/api/app/core/datauri.py`, which both upload endpoints enforce.
 *
 * In bytes rather than characters of data URL, which is what this file used to compare. The
 * character limit on the field is deliberately well above the byte limit — a request a little over
 * has to reach the server's own check to be told what is wrong with it — so measuring the string
 * against it accepted files the server then refused. `tools/check_upload_types.py` compares this
 * number with the server's.
 */
export const MAX_UPLOAD_BYTES = 11_000_000;

/** How many bytes a base64 payload carries: four characters per three bytes, less the padding. */
export function byteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Tried in order, only when the original does not fit. 2400px keeps the text in a screenshot
 * of a message legible, which is what most evidence is.
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

  // The fractions always follow, never only when the ceilings left too little. Returning early
  // once two ceilings applied put a cliff at each one: a 1601px source got 1600 and 1200 and
  // nothing else, so a tall screenshot still over the cap at 1200 was refused — while a 1600px
  // source, one pixel narrower, went on to 800, 528 and 400 and fitted.
  //
  // They halve from the smallest step so far rather than from the source, so the ladder keeps
  // descending instead of landing next to a ceiling it already tried.
  const smallest = steps.length ? steps[steps.length - 1].width : sourceWidth;
  for (const [scale, compress] of [
    [0.5, 0.7],
    [0.33, 0.6],
    [0.25, 0.5],
  ] as const) {
    const width = Math.round(smallest * scale);
    if (width < MIN_WIDTH || width >= sourceWidth) continue;
    if (steps.some((s) => s.width === width)) continue;
    steps.push({ width, compress });
  }

  // Nothing narrower came out of the ceilings or the fractions — a source already near the floor.
  // Re-encode at the width it has: the resize is a no-op, and turning a PNG screenshot into a JPEG
  // is most of the saving anyway, so this is a real attempt rather than a formality. It is tried
  // first, being the widest, so an image that fits at full width is never downscaled for nothing.
  if (!steps.length) steps.push({ width: sourceWidth, compress: 0.6 });

  // And the floor itself, which the ladder could not previously reach. Every fraction of a source
  // under about 479px rounds below MIN_WIDTH and is skipped, so a 400px-wide screenshot thousands
  // of pixels tall got one no-op re-encode and then a refusal — while 240px, the width this file
  // declares readable, was never tried at all. The member was told their evidence was too large on
  // a safety report when the one step that would have fitted was the one being withheld.
  const narrowest = steps.reduce((min, step) => Math.min(min, step.width), Infinity);
  if (MIN_WIDTH < sourceWidth && narrowest > MIN_WIDTH) steps.push({ width: MIN_WIDTH, compress: 0.5 });

  return steps.sort((a, b) => b.width - a.width);
}

export type Prepared = { contentType: string; base64: string; sizeBytes: number };

/**
 * The image as the API will accept it, or null when even the smallest step is too big.
 *
 * An image that already fits is sent at the picker's own quality rather than being resized and
 * re-encoded again, because every extra pass softens the text a reviewer needs to read. Shrinking
 * happens only when the alternative is not sending it at all.
 *
 * It is JPEG either way: the picker's `base64` is the asset's JPEG data whatever the asset was, so
 * there is no PNG left to preserve by the time this sees it.
 */
export async function fitForUpload(asset: ImagePicker.ImagePickerAsset, base64: string): Promise<Prepared | null> {
  // JPEG, not `asset.mimeType`. The installed expo-image-picker says so of `base64` itself:
  // "a Base64-encoded string of the selected image's JPEG data... prepend this with
  // 'data:image/jpeg;base64,'" (ImagePicker.types.d.ts). `mimeType` describes the *asset the member
  // picked*, which is a different thing — so labelling these bytes with it declared a HEIC photo or
  // a PNG screenshot and sent JPEG. Harmless until the server started checking that a file looks
  // like what it says, and then it refused every screenshot that was not already a JPEG.
  const prepared = (b64: string): Prepared => ({ contentType: "image/jpeg", base64: b64, sizeBytes: byteLength(b64) });
  if (byteLength(base64) <= MAX_UPLOAD_BYTES) return prepared(base64);
  for (const step of shrinkSteps(asset.width)) {
    // The contextual API; manipulateAsync is deprecated in this SDK.
    const rendered = await ImageManipulator.manipulate(asset.uri).resize({ width: step.width }).renderAsync();
    const out = await rendered.saveAsync({ base64: true, compress: step.compress, format: SaveFormat.JPEG });
    if (out.base64 && byteLength(out.base64) <= MAX_UPLOAD_BYTES) return prepared(out.base64);
  }
  return null;
}

/** The data URL the two upload endpoints take. */
export const dataUrl = (contentType: string, base64: string) => `data:${contentType};base64,${base64}`;
