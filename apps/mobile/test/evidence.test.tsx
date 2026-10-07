import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { renderScreen } from "./render";

/**
 * POST /safety/reports/{id}/evidence. A screenshot is often the whole report, and the
 * screenshot lives on the phone — which was the one client that could not send it.
 */
const mockPost = jest.fn();
jest.mock("@/api/client", () => ({
  get: jest.fn(),
  post: (p: string, b: unknown) => mockPost(p, b),
  del: jest.fn(),
  // Faithful to src/api/client.ts, which stores both: a double that drops `body` made the
  // component's own errors look like unknown ones and get replaced with a generic message.
  ApiError: class extends Error {
    status: number;
    body: { code: string; message: string };
    constructor(s: number, b: { code: string; message: string }) {
      super(b.message);
      this.status = s;
      this.body = b;
    }
  },
}));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
const mockSave = jest.fn();
const mockResize = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      resize: (size: { width: number }) => {
        mockResize(size);
        return { renderAsync: () => Promise.resolve({ saveAsync: (o: unknown) => mockSave(size, o) }) };
      },
    }),
  },
}));

import { EvidenceAttach, shrinkSteps } from "@/components/EvidenceAttach";

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  mockResize.mockReset();
  mockSave.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ evidence_id: "ev_1", retention: "Kept under the case retention policy." });
  picker.requestMediaLibraryPermissionsAsync.mockReset();
  picker.launchImageLibraryAsync.mockReset();
});

test("sends the image as a data URL with the description the member wrote", async () => {
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ base64: "QUJD", mimeType: "image/png", fileSize: 1234 }],
  } as never);

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.type("The message where he asks for a gift card");
  await s.press("Choose a screenshot");
  await s.settle();

  // size_bytes comes from the bytes actually sent, not from asset.fileSize: once an image has
  // been shrunk to fit, fileSize is the size of the original and would be a lie.
  expect(mockPost).toHaveBeenCalledWith("/safety/reports/case_1/evidence", {
    content_type: "image/png",
    size_bytes: 3,
    checksum: null,
    description: "The message where he asks for a gift card",
    data_url: "data:image/png;base64,QUJD",
  });
  expect(s.hasText("Attached")).toBe(true);
});

test("a denied photo permission explains itself and sends nothing", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false } as never);

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  expect(alert).toHaveBeenCalled();
  expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});

test("a cancelled picker is not an error", async () => {
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null } as never);

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  expect(mockPost).not.toHaveBeenCalled();
  expect(s.hasText("Attached")).toBe(false);
});

test("a failed upload is shown rather than silently dropped", async () => {
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ base64: "QUJD", mimeType: "image/jpeg" }],
  } as never);
  mockPost.mockRejectedValue(
    Object.assign(new Error("That case is closed."), { status: 409, body: { code: "CONFLICT", message: "That case is closed." } }),
  );

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  expect(s.joined()).toContain("That case is closed.");
  expect(s.hasText("Attached")).toBe(false);
});

/** `EvidenceIn.data_url` is capped at 15,000,000 characters, so base64 over ~11 MB is refused. */
const OVERSIZED = "A".repeat(15_000_001);

test("the picker is not asked to recompress on the way in", async () => {
  // `quality` defaults to 1.0 and anything lower asks the picker to recompress, so passing 0.9
  // softened every screenshot before fitForUpload ever saw it — including the ones that could
  // have been sent exactly as the member had them.
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///shot.png", base64: "QUJD", mimeType: "image/png" }],
  } as never);

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  const opts = picker.launchImageLibraryAsync.mock.calls.at(-1)![0] as { quality?: number };
  expect(opts.quality).toBeUndefined();
});

test("an image that already fits is sent untouched", async () => {
  // Re-encoding a clean PNG screenshot as JPEG for no reason would soften the text a reviewer
  // needs to read, so nothing is shrunk unless it has to be.
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///shot.png", base64: "QUJD", mimeType: "image/png" }],
  } as never);

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  expect(mockResize).not.toHaveBeenCalled();
  expect(mockPost.mock.calls[0][1]).toMatchObject({ content_type: "image/png", data_url: "data:image/png;base64,QUJD" });
});

test("a photo too large for the API is shrunk rather than rejected", async () => {
  // A full-resolution camera photo exceeds the cap, and "Take a photo" is one of the two
  // buttons on this screen. Unshrunk it came back as a generic validation error — on the path
  // somebody uses to report being harassed.
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchCameraAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///huge.jpg", base64: OVERSIZED, mimeType: "image/jpeg" }],
  } as never);
  mockSave.mockResolvedValue({ base64: "U01BTEw=" });

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Take a photo");
  await s.settle();

  expect(mockResize).toHaveBeenCalledWith({ width: 2400 });
  expect(mockPost.mock.calls[0][1]).toMatchObject({
    content_type: "image/jpeg",
    data_url: "data:image/jpeg;base64,U01BTEw=",
  });
  expect(s.hasText("Attached")).toBe(true);
});

test("shrinking steps down until it fits", async () => {
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///huge.jpg", base64: OVERSIZED, mimeType: "image/jpeg" }],
  } as never);
  // Still too big at 2400 and 1600; fits at 1200.
  mockSave.mockImplementation((size: { width: number }) =>
    Promise.resolve({ base64: size.width === 1200 ? "T0s=" : OVERSIZED }),
  );

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  expect(mockResize.mock.calls.map(([size]) => size.width)).toEqual([2400, 1600, 1200]);
  expect(mockPost.mock.calls[0][1]).toMatchObject({ data_url: "data:image/jpeg;base64,T0s=" });
});

test("an image too large even shrunk says so, instead of a generic validation error", async () => {
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///huge.jpg", base64: OVERSIZED, mimeType: "image/jpeg" }],
  } as never);
  mockSave.mockResolvedValue({ base64: OVERSIZED });

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  expect(mockPost).not.toHaveBeenCalled();
  expect(s.joined()).toContain("A screenshot of the same thing will usually go through.");
});

test("a camera that refuses to open is reported, not swallowed", async () => {
  // The permission request and the picker launch used to sit outside the guard, and the button
  // discards this promise with `void` — so this became an unhandled rejection and the member saw
  // nothing at all, on the screen for attaching evidence of being harassed.
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchCameraAsync.mockRejectedValue(new Error("Camera unavailable"));

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Take a photo");
  await s.settle();

  expect(s.joined()).toContain("The camera could not be opened.");
  expect(mockPost).not.toHaveBeenCalled();
});

test("a permission request that throws is reported too", async () => {
  picker.requestMediaLibraryPermissionsAsync.mockRejectedValue(new Error("OS refused"));

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  expect(s.joined()).toContain("Your photos could not be opened.");
  expect(mockPost).not.toHaveBeenCalled();
});

/**
 * `resize({ width })` sets the result width — expo-image-manipulator's own types say "Values
 * correspond to the result image dimensions" — so it is not a maximum bound. A fixed ladder of
 * 2400/1600/1200 therefore *enlarged* anything narrower than 1200, which a long chat screenshot
 * usually is: all three steps made it bigger, it never fell under the cap, and the member was
 * told it was too large to attach when downscaling would have worked.
 */
describe("shrinkSteps", () => {
  test("a wide camera photo starts at the ceilings and carries on below them", () => {
    // The ceilings keep their place at the top — 2400 is where a message in a photo is still
    // legible — and the fractions follow rather than replacing them, so there is somewhere to go
    // when 1200 is still too big.
    const widths = shrinkSteps(4032).map((s) => s.width);
    expect(widths.slice(0, 3)).toEqual([2400, 1600, 1200]);
    expect(widths.length).toBeGreaterThan(3);
    expect(widths[widths.length - 1]).toBeLessThan(1200);
  });

  test("a narrow long screenshot gets steps that are actually smaller", () => {
    const steps = shrinkSteps(1170);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.width).toBeLessThan(1170);
    expect(steps.map((s) => s.width)).toEqual([585, 386, 293]);
  });

  test("no step ever enlarges the source, at any width", () => {
    // At or below the source, never above: a step *equal* to the source is a no-op resize whose
    // point is the JPEG re-encode, which is the only thing left to try for a source already at the
    // floor. Anything above would be the original bug.
    for (const w of [240, 320, 400, 720, 900, 1080, 1170, 1200, 1201, 1600, 1601, 2000, 2400, 3000, 4032, 8000]) {
      const steps = shrinkSteps(w);
      expect(steps.length).toBeGreaterThan(0);
      for (const s of steps) expect(s.width).toBeLessThanOrEqual(w);
    }
  });

  test("one pixel of source width is not the difference between fitting and being refused", () => {
    // Returning early once two ceilings applied put a cliff at each one: 1601 stopped at 1200
    // while 1600 carried on to 800 and below, so a tall screenshot still over the cap at 1200 was
    // refused for being one pixel wider.
    const justOver = shrinkSteps(1601).map((s) => s.width);
    const justUnder = shrinkSteps(1600).map((s) => s.width);
    expect(justOver[justOver.length - 1]).toBeLessThan(1200);
    expect(justUnder[justUnder.length - 1]).toBeLessThan(1200);
    // Both end in the same place; the wider source simply has one more rung at the top.
    expect(justOver.filter((w) => w < 1200)).toEqual(justUnder.filter((w) => w < 1200));
  });

  test("a source already at the floor still gets one real attempt", () => {
    // Nothing narrower is worth asking for, but a huge PNG re-encoded as JPEG is most of the
    // saving, so refusing without trying would be giving up early.
    const steps = shrinkSteps(300);
    expect(steps).toHaveLength(1);
    expect(steps[0].width).toBe(300);
  });

  test("steps only ever descend", () => {
    for (const w of [900, 1300, 2000, 4032]) {
      const widths = shrinkSteps(w).map((s) => s.width);
      expect(widths).toEqual([...widths].sort((a, b) => b - a));
    }
  });

  test("an asset with no reported width falls back to the ceilings", () => {
    expect(shrinkSteps(undefined).map((s) => s.width)).toEqual([2400, 1600, 1200]);
    expect(shrinkSteps(0).map((s) => s.width)).toEqual([2400, 1600, 1200]);
  });
});

test("a long screenshot narrower than the ceilings is shrunk, not enlarged", async () => {
  // End to end through the component: the asset reports its width, and every resize asked for is
  // below it. With the fixed ladder this sent resize({width: 2400}) on a 1170px image.
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///chat.png", base64: OVERSIZED, mimeType: "image/png", width: 1170, height: 9400 }],
  } as never);
  mockSave.mockImplementation((size: { width: number }) =>
    Promise.resolve({ base64: size.width <= 585 ? "T0s=" : OVERSIZED }),
  );

  const s = await renderScreen(<EvidenceAttach reportId="case_1" />);
  await s.press("Choose a screenshot");
  await s.settle();

  const asked = mockResize.mock.calls.map(([size]) => size.width);
  expect(asked.length).toBeGreaterThan(0);
  for (const w of asked) expect(w).toBeLessThan(1170);
  expect(mockPost.mock.calls[0][1]).toMatchObject({ data_url: "data:image/jpeg;base64,T0s=" });
  expect(s.hasText("Attached")).toBe(true);
});
