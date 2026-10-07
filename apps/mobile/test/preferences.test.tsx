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
      active: true,
      inactive_reason: null,
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

test("a preview that lands after an edit does not unlock Save for uncosted values", async () => {
  // The race the review found: clearing `impact` on every edit was not enough, because a
  // request already in flight would resolve afterwards and put it back.
  const s2 = await renderScreen(<YouPreferences />);
  await s2.press("Change");

  let resolvePreview: ((v: unknown) => void) | undefined;
  mockPost.mockImplementation(() => new Promise((res) => { resolvePreview = res; }));
  await s2.press("Check the impact");           // in flight
  await s2.press("Open");                        // the member changes the tier meanwhile
  resolvePreview?.({ key: "children", tier: "must", eligible_now: 12, eligible_after: 9, pool_size: 30, message: "Nine." });
  await s2.settle();

  // The response was computed for tier=must; the edit is now tier=open, so it must not count.
  expect(s2.hasText("Check the impact first")).toBe(true);
  expect(s2.hasText("Save")).toBe(false);
  expect(mockPatch).not.toHaveBeenCalled();
});

test("a preview for the current values does unlock Save", async () => {
  const s2 = await renderScreen(<YouPreferences />);
  await s2.press("Change");
  mockPost.mockResolvedValue({ key: "children", tier: "must", eligible_now: 12, eligible_after: 9, pool_size: 30, message: "Nine." });
  await s2.press("Check the impact");
  expect(s2.hasText("Save")).toBe(true);
});

test("a preference the matcher is ignoring does not claim to be a hard gate", async () => {
  // Withdrawing special-category consent stops build_snapshot applying a faith preference at
  // every tier, but the row stays — so the screen kept showing "must" for a criterion that was
  // gating nobody, and offered a Change that would come back 403.
  mockGet.mockImplementation(
    routeGet({
      "/preferences": {
        ...PREFS,
        preferences: [
          {
            ...PREFS.preferences[0],
            key: "faith_importance",
            label: "Faith in daily life",
            active: false,
            inactive_reason: "special_category_consent_withdrawn",
          },
        ],
      },
    }),
  );
  const s = await renderScreen(<YouPreferences />);
  expect(s.hasText("Faith in daily life")).toBe(true);
  expect(s.hasText("must")).toBe(false);
  expect(s.hasText("not in use")).toBe(true);
  expect(s.joined()).toContain("not being applied to your introductions");
  // No control whose only outcome is a refusal; a way to the consent that would restore it.
  expect(s.texts()).not.toContain("Change");
  expect(s.hasText("Review your consents")).toBe(true);
});

test("a preference with no `active` field is still treated as in use", async () => {
  // A store build can meet an API that predates the field. Defaulting to "not in use" would
  // blank out every criterion the member has, which is worse than the bug it guards against.
  const { active, inactive_reason, ...legacy } = PREFS.preferences[0];
  mockGet.mockImplementation(routeGet({ "/preferences": { ...PREFS, preferences: [legacy] } }));
  const s = await renderScreen(<YouPreferences />);
  expect(s.hasText("must")).toBe(true);
  expect(s.hasText("Change")).toBe(true);
  expect(s.hasText("not in use")).toBe(false);
});
