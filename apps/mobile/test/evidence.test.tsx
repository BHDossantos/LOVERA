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

import { EvidenceAttach } from "@/components/EvidenceAttach";

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
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

  expect(mockPost).toHaveBeenCalledWith("/safety/reports/case_1/evidence", {
    content_type: "image/png",
    size_bytes: 1234,
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
