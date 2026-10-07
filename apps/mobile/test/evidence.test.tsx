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
  // The component constructs one of these itself when an asset has no base64 payload.
  ApiError: class extends Error {
    constructor(s: number, b: { code: string; message: string }) {
      super(b.message);
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

import { EvidenceAttach } from "@/components/EvidenceAttach";

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
