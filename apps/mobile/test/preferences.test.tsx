import { renderScreen, routeGet } from "./render";

/**
 * Three findings a review bot caught on code already merged. Each gets a test, because the
 * review was right and my own checks were not looking.
 */
const PREFS = {
  preferences: [
    {
      id: "p1",
      key: "children",
      label: "Children",
      description: "What you want.",
      tier: "must",
      operator: "in",
      value: { in: ["open"] },
      options: [
        { value: "yes", label: "Yes" },
        { value: "open", label: "Open to it" },
      ],
      updated_at: null,
    },
  ],
  // The API returns options: null for any preference whose target is not a blueprint
  // signal, and languages is one of those.
  available: [
    {
      key: "languages",
      label: "Shared language",
      description: "Languages you want in common.",
      default_tier: "prefer",
      operator: "any_of",
      options: null,
    },
  ],
  tier_meaning: { must: "Hard gate.", prefer: "Weighted.", open: "Light." },
};

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, body?: unknown) => mockPost(p, body),
  patch: (p: string, body?: unknown) => mockPatch(p, body),
  del: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({ useRequireMember: () => ({ me: { id: "mem_me" } }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

import YouPreferences from "../app/(app)/you/preferences";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPatch.mockReset();
  mockGet.mockImplementation(routeGet({ "/preferences": PREFS }));
});

test("the shared-language preference still offers languages when the API sends none", async () => {
  const s = await renderScreen(<YouPreferences />);
  await s.press("Set this up");
  // Without the fallback the chooser was skipped entirely and the preference saved empty.
  expect(s.hasText("Italiano")).toBe(true);
  expect(s.hasText("English")).toBe(true);
  expect(s.hasText("Ranges are set during the blueprint interview")).toBe(false);
});

test("saving is impossible until the member has seen what the change costs", async () => {
  const s = await renderScreen(<YouPreferences />);
  await s.press("Change");
  // The screen promises the trade-off before the commitment, so the commitment has to wait.
  // The button relabels itself rather than sitting there greyed and unexplained, so "Save"
  // is genuinely not on screen yet.
  expect(s.hasText("Check the impact first")).toBe(true);
  await expect(s.press("Check the impact first")).rejects.toThrow(/disabled/);
  expect(mockPatch).not.toHaveBeenCalled();

  mockPost.mockResolvedValue({ key: "children", tier: "must", eligible_now: 12, eligible_after: 9, pool_size: 30, message: "Nine people would still match." });
  await s.press("Check the impact");
  expect(s.hasText("Nine people would still match.")).toBe(true);

  mockPatch.mockResolvedValue(PREFS);
  await s.press("Save");
  expect(mockPatch).toHaveBeenCalledWith("/preferences/children", expect.objectContaining({ tier: "must" }));
});

test("an edit clears the preview, so the saved value is always one that was costed", async () => {
  const s = await renderScreen(<YouPreferences />);
  await s.press("Change");
  mockPost.mockResolvedValue({ key: "children", tier: "must", eligible_now: 12, eligible_after: 9, pool_size: 30, message: "Nine." });
  await s.press("Check the impact");
  expect(s.hasText("Save")).toBe(true);
  // Changing the tier after previewing must take the save away again.
  await s.press("Open");
  expect(s.hasText("Save")).toBe(false);
  expect(s.hasText("Check the impact first")).toBe(true);
});
