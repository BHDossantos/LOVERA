import * as ImagePicker from "expo-image-picker";
import { renderScreen } from "./render";

/**
 * Adding a profile photo from a phone, which is the one client where the photo is the size of a
 * camera's output rather than something already on a disk.
 *
 * The crop to 4:5 and `quality: 0.8` the picker is asked for were doing the shrinking implicitly,
 * and they do it for a 12-megapixel camera. The editor crops at the source's resolution, so on a
 * 50- or 200-megapixel phone the result is still far over what the endpoint takes — and what came
 * back for it was a bare string-length error on the `data_url` field, which the API renders as
 * "Some fields need attention." The member with the newest phone was the one who could not add a
 * photo, and nothing told them why.
 */
const mockPost = jest.fn();
const mockGet = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, b: unknown) => mockPost(p, b),
  patch: jest.fn(),
  del: jest.fn(),
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

import { ProfileEditor } from "@/components/ProfileEditor";
import { MAX_UPLOAD_BYTES, byteLength } from "@/lib/upload";

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

const PROFILE = {
  display_name: "Nadia",
  pronouns: "she/her",
  occupation: "Architect",
  bio: "Slow mornings and long lunches.",
  languages: ["English"],
  prompts: [{ key: "second_date", answer: "Somewhere with good coffee." }],
  available_prompts: [{ key: "second_date", label: "A good second date" }],
  media: [],
  completeness: 60,
  version: 3,
  visibility_map: {},
};

/** Base64 carrying `bytes` bytes. The content does not matter; only how much of it there is. */
const b64 = (bytes: number) => "A".repeat(Math.ceil((bytes * 4) / 3));

beforeEach(() => {
  mockResize.mockReset();
  mockSave.mockReset();
  mockPost.mockReset();
  mockGet.mockReset();
  mockGet.mockResolvedValue(PROFILE);
  mockPost.mockImplementation((p: string) =>
    p === "/profile/media" ? Promise.resolve({ media: { id: "med_1" } }) : Promise.resolve({}),
  );
  picker.requestMediaLibraryPermissionsAsync.mockReset();
  picker.launchImageLibraryAsync.mockReset();
});

afterEach(() => jest.restoreAllMocks());

const pick = (asset: Record<string, unknown>) => {
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [asset] } as never);
};

test("a photo that fits is sent untouched, and declares the bytes it is sending", async () => {
  pick({ base64: "QUJDRA==", mimeType: "image/heic", fileSize: 9_999_999, width: 3024, uri: "file:///p.heic" });

  const s = await renderScreen(<ProfileEditor />);
  await s.press("Choose from library");

  expect(mockResize).not.toHaveBeenCalled();
  const create = mockPost.mock.calls.find(([p]) => p === "/profile/media");
  expect(create).toBeTruthy();
  // `fileSize` describes the HEIC the picker opened; the bytes going out are the JPEG it handed us.
  // The server records what arrives, so a declared size that describes another file is a lie the
  // first gate is checked against.
  expect(create![1]).toMatchObject({ type: "photo", content_type: "image/jpeg", size_bytes: byteLength("QUJDRA==") });
  const complete = mockPost.mock.calls.find(([p]) => String(p).endsWith("/complete"));
  expect(complete![1]).toEqual({ data_url: "data:image/jpeg;base64,QUJDRA==" });
});

test("a photo off a very large sensor is shrunk until it fits", async () => {
  const tooBig = b64(MAX_UPLOAD_BYTES + 500_000);
  pick({ base64: tooBig, mimeType: "image/jpeg", fileSize: tooBig.length, width: 8000, uri: "file:///big.jpg" });
  mockSave.mockResolvedValue({ base64: "U01BTEw=" });

  const s = await renderScreen(<ProfileEditor />);
  await s.press("Choose from library");

  expect(mockResize).toHaveBeenCalled();
  // Widest step first, so a photo that fits after one pass is never downscaled further than it has
  // to be.
  expect(mockResize.mock.calls[0][0].width).toBe(2400);
  const complete = mockPost.mock.calls.find(([p]) => String(p).endsWith("/complete"));
  expect(complete![1]).toEqual({ data_url: "data:image/jpeg;base64,U01BTEw=" });
  const create = mockPost.mock.calls.find(([p]) => p === "/profile/media");
  expect(create![1]).toMatchObject({ size_bytes: byteLength("U01BTEw=") });
});

test("a photo that will not fit at any size says so, and creates nothing", async () => {
  const tooBig = b64(MAX_UPLOAD_BYTES + 500_000);
  pick({ base64: tooBig, mimeType: "image/jpeg", fileSize: tooBig.length, width: 8000, uri: "file:///big.jpg" });
  // Every step comes back still too large.
  mockSave.mockResolvedValue({ base64: tooBig });

  const s = await renderScreen(<ProfileEditor />);
  await s.press("Choose from library");

  expect(mockPost).not.toHaveBeenCalled();
  expect(s.texts().join(" ")).toContain("too large to upload");
});
