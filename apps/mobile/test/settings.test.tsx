import { renderScreen, routeGet } from "./render";

/**
 * `PATCH /me` was the last member endpoint mobile did not reach, and the field behind it is not
 * cosmetic: availability windows are weekday and clock time, and the server reads them in
 * `member.timezone` when it works out when two people could both meet. A member who moved city
 * kept the zone of the city they left, with no screen able to change it.
 */
const ME = {
  id: "mem_me",
  email: "me@example.test",
  locale: "en",
  timezone: "Europe/Rome",
  date_ready: true,
  verification_status: "verified",
  capabilities: { entitlements: { plan_name: "Free" } },
};

const mockGet = jest.fn();
const mockPatch = jest.fn();
const mockPush = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, b: unknown) => mockPatch(p, b),
  put: (p: string, b: unknown) => mockPatch(p, b),
  patch: (p: string, b: unknown) => mockPatch(p, b),
  del: (p: string) => mockPatch(p),
  newIdempotencyKey: () => "idem_test",
  ApiError: class extends Error {},
}));
let me: typeof ME | null = ME;
const mockRefresh = jest.fn();
jest.mock("@/lib/auth", () => ({
  useRequireMember: () => ({ me: (require("./settings.test") as { currentMe: () => unknown }).currentMe() }),
  useAuth: () => ({ refresh: () => mockRefresh(), signOut: jest.fn() }),
  nextOnboardingPath: () => "/today",
}));
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => (require("./render") as { mockUseFocusEffect: (c: () => void | (() => void)) => void }).mockUseFocusEffect(cb),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn() }),
}));

/** Read through a function so the auth mock sees the value this test set, not the one at import. */
export function currentMe() {
  return me;
}

import Settings from "../app/(app)/you/settings";
import You from "../app/(app)/you/index";

beforeEach(() => {
  me = ME;
  mockGet.mockReset();
  mockPatch.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockPatch.mockResolvedValue({});
  mockGet.mockImplementation(routeGet({ "/me/privacy": { paused: false, deletion_due_at: null } }));
});

test("the You tab can reach the screen that changes them", async () => {
  const s = await renderScreen(<You />);
  await s.press("Language and time zone");
  expect(mockPush).toHaveBeenCalledWith("/you/settings");
});

test("nothing is sent until something is chosen, and then both fields go together", async () => {
  const s = await renderScreen(<Settings />);

  // `PATCH /me` replaces both fields, so a save with nothing changed would be a no-op write at
  // best — and the button says so rather than looking broken.
  await expect(s.press("Save")).rejects.toThrow(/nothing pressable/);
  expect(s.hasText("Nothing to save")).toBe(true);

  await s.press("Madrid");
  await s.press("Save");

  expect(mockPatch).toHaveBeenCalledWith("/me", { locale: "en", timezone: "Europe/Madrid" });
  // Every screen reads `me`, including the badge on the You tab, so it is refetched rather than
  // patched locally from the response.
  expect(mockRefresh).toHaveBeenCalled();
});

test("a language change is sent with the zone the member already had", async () => {
  const s = await renderScreen(<Settings />);
  await s.press("Italiano");
  await s.press("Save");
  expect(mockPatch).toHaveBeenCalledWith("/me", { locale: "it", timezone: "Europe/Rome" });
});

test("the member's own zone is offered even when it is not one of ours", async () => {
  me = { ...ME, timezone: "America/Sao_Paulo" };
  const s = await renderScreen(<Settings />);

  expect(s.hasText("Sao Paulo")).toBe(true);
  expect(s.joined()).toContain("Set on your account");
  // And it is the selected one, so opening the screen cannot quietly move somebody to Rome.
  await expect(s.press("Save")).rejects.toThrow(/nothing pressable/);
});

test("a screen opened before `me` has arrived does not post a default over what was stored", async () => {
  /**
   * The ordinary way a settings screen loses somebody's data: copy the fields out of `me` on
   * mount, mount before the member payload lands, and the first save writes the fallbacks. The
   * draft is an override on top of `me` instead, so there is nothing to save until a choice is
   * made.
   */
  me = null;
  const s = await renderScreen(<Settings />);
  await expect(s.press("Save")).rejects.toThrow(/nothing pressable/);
  expect(mockPatch).not.toHaveBeenCalled();
});

test("a failed save says so and keeps the choice", async () => {
  mockPatch.mockRejectedValue(Object.assign(new Error("We could not save that."), { status: 503, body: { code: "UNAVAILABLE", message: "We could not save that.", retryable: true } }));
  const s = await renderScreen(<Settings />);

  await s.press("Madrid");
  await s.press("Save");

  expect(s.hasText("We could not save that.")).toBe(true);
  // Still dirty: the member can press Save again without re-choosing.
  await s.press("Save");
  expect(mockPatch).toHaveBeenCalledTimes(2);
});
