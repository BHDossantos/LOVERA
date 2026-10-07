import { renderScreen, routeGet } from "./render";

/**
 * Two routes the API already pointed at and this app did not have.
 *
 * GET /introductions/waiting is where Today sends a member when there is nothing to do, and
 * /introductions/{id}/mutual is where the "you both said yes" notification deep-links. Both
 * were dead taps on mobile.
 */
const WAITING = {
  eligible_after_must: 3,
  verified_pool: 48,
  capacity: 2,
  reasons: [
    { code: "thin_inventory", text: "Only 3 verified members pass both sides' Must criteria." },
  ],
  protected_credits: 1,
  next_batch: "weekly",
  broaden_hint: "You can preview what a broader Prefer setting would change before saving anything.",
};

const mockGet = jest.fn();
const mockPush = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: jest.fn(),
  del: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({ useRequireMember: () => ({ me: { id: "mem_me" } }) }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "intro_1" }),
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn() }),
}));

import Waiting from "../app/(app)/introductions/waiting";
import Mutual from "../app/(app)/introductions/[id]/mutual";

beforeEach(() => {
  mockGet.mockReset();
  mockPush.mockReset();
});

test("an empty week says why, with the numbers behind it", async () => {
  mockGet.mockImplementation(routeGet({ "/introductions/waiting": WAITING }));
  const s = await renderScreen(<Waiting />);
  expect(s.joined()).toContain("Only 3 verified members pass both sides' Must criteria.");
  expect(s.joined()).toContain("48");
  expect(s.hasText("Who pass both sides' Must criteria")).toBe(true);
  expect(s.joined()).toContain("1 kept for you");
  expect(s.joined()).not.toContain("undefined");
});

test("the mutual screen opens the conversation it was told about", async () => {
  mockGet.mockImplementation(
    routeGet({
      "/introductions/intro_1": {
        id: "intro_1",
        status: "mutual",
        version: 4,
        conversation_id: "conv_9",
        expires_at: null,
        actions: { can_accept: false, can_decline: false, can_extend: false },
        profile: { display_name: "Ben", age: 38, city: "Rome", verified: true, media: [], prompts: [], bio: null },
        explanation: null,
      },
    }),
  );
  const s = await renderScreen(<Mutual />);
  expect(s.joined()).toContain("You and Ben both said yes");
  await s.press("Start the conversation");
  expect(mockPush).toHaveBeenCalledWith("/messages/conv_9");
});

test("a one-sided yes is not dressed up as mutual", async () => {
  // The deep link can be opened before the other person has decided. Showing a celebration
  // then would leak the fact that only one of them has answered.
  mockGet.mockImplementation(
    routeGet({
      "/introductions/intro_1": {
        id: "intro_1",
        status: "awaiting_other_member",
        version: 2,
        conversation_id: null,
        expires_at: null,
        actions: { can_accept: false, can_decline: false, can_extend: false },
        profile: { display_name: "Ben", age: 38, city: "Rome", verified: true, media: [], prompts: [], bio: null },
        explanation: null,
      },
    }),
  );
  const s = await renderScreen(<Mutual />);
  expect(s.hasText("Not mutual yet")).toBe(true);
  // No celebration, and nothing about the other person — the banner only states the rule.
  expect(s.joined()).not.toContain("You and Ben both said yes");
  expect(s.joined()).not.toContain("Ben");
});
