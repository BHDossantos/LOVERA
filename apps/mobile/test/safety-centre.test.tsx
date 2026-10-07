import { Alert, Linking } from "react-native";
import { renderScreen, routeGet } from "./render";

/**
 * Payloads copied from what the API returns, not from what the client wished for:
 *   GET /safety       -> app/modules/safety/service.py::safety_center
 *   GET /safety/cases -> {"items": [...]}
 *   GET /blocks       -> {"items": [...]}
 *
 * The first test exists because `blocks` and `open_cases` are counts and `emergency` is an
 * object. The screen used to treat all three as something else and threw while rendering.
 */
const SAFETY = {
  emergency: { number: "112", note: "Italy: 112 for police, medical and fire." },
  disclaimer: "This app is not an emergency service.",
  actions: [{ key: "report", label: "Report someone", path: "/safety/report" }],
  education: ["Never send money to someone you met here."],
  categories: [{ key: "harassment", severity: "high" }],
  open_cases: 1,
  blocks: 2,
};
const CASES = {
  items: [{ id: "case_1", category: "harassment", state: "triaged", opened_at: "2026-10-01T10:00:00Z" }],
};
const BLOCKS = {
  items: [
    { member_id: "mem_a", display_name: "Ana", created_at: "2026-09-20T10:00:00Z" },
    { member_id: "mem_b", display_name: "Ben", created_at: "2026-09-21T10:00:00Z" },
  ],
};

const mockGet = jest.fn();
const mockDel = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  del: (p: string) => mockDel(p),
  post: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({ useRequireMember: () => ({ me: { id: "mem_me" } }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

import SafetyCentre from "../app/safety/index";

afterEach(() => {
  // Spies on shared singletons like Alert accumulate across tests, so calls[0] belongs to
  // whichever test ran first and its handlers close over that render's state setters.
  jest.restoreAllMocks();
});

beforeEach(() => {
  mockGet.mockReset();
  mockDel.mockReset();
  mockGet.mockImplementation(routeGet({ "/safety/cases": CASES, "/blocks": BLOCKS, "/safety": SAFETY }));
});

test("renders the payload the API really sends, where counts are counts", async () => {
  // Rendering without throwing is the assertion: cases.map on undefined and blocks.map on
  // a number both threw before the declared type was corrected.
  const s = await renderScreen(<SafetyCentre />);
  expect(s.hasText("Safety centre")).toBe(true);
  expect(s.hasText("Italy: 112 for police, medical and fire.")).toBe(true);
});

test("the emergency button dials a usable tel: URI, not the emergency object", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const s = await renderScreen(<SafetyCentre />);
  await s.press("Call 112");
  expect(openURL).toHaveBeenCalledWith("tel:112");
  expect(openURL.mock.calls.flat().join()).not.toContain("[object");
});

test("lists cases from /safety/cases and blocks from /blocks", async () => {
  const s = await renderScreen(<SafetyCentre />);
  expect(s.hasText("Harassment or unwanted contact")).toBe(true);
  expect(s.hasText("Ana")).toBe(true);
  expect(s.hasText("Ben")).toBe(true);
  expect(s.texts().filter((t) => t === "Unblock")).toHaveLength(2);
});

test("unblocking sends the blocked member's id, not the block row id", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockDel.mockResolvedValue(undefined);
  const s = await renderScreen(<SafetyCentre />);
  await s.press("Unblock");
  // The confirmation is a native Alert, so invoke the action the member would choose.
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await s.settle();
  buttons.find((b) => b.text === "Unblock")?.onPress?.();
  await s.settle();
  expect(mockDel).toHaveBeenCalledWith(expect.stringMatching(/^\/blocks\/mem_[ab]$/));
});

test("a failed unblock is shown to the member, not swallowed", async () => {
  // This had no rejection handler: the block stayed, nothing was said, and React Native got
  // an unhandled rejection. An offline device is the ordinary case, not an edge one.
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  // Exactly what api() throws when fetch rejects — see src/api/client.ts.
  mockDel.mockRejectedValue(
    Object.assign(new Error("You appear to be offline. Nothing was lost."), {
      status: 0,
      body: { code: "OFFLINE", message: "You appear to be offline. Nothing was lost.", retryable: true },
    }),
  );
  const s = await renderScreen(<SafetyCentre />);
  await s.press("Unblock");
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === "Unblock")?.onPress?.();
  await s.settle();
  expect(s.joined()).toContain("You appear to be offline");
  // And the member can try again rather than being stuck on a spinner.
  expect(s.texts().filter((t) => t === "Unblock")).toHaveLength(2);
});
