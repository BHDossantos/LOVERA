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
/** GET /safety/cases -> {"items": [case_payload(...)]}. Every field here is one the API sends. */
const CASES = {
  items: [
    {
      id: "case_1",
      receipt_code: "SR-7Q2F",
      category: "harassment",
      severity: "P2",
      status: "triaged",
      submitted_at: "2026-10-01T10:00:00Z",
      updated_at: "2026-10-02T10:00:00Z",
      protection_applied: ["contact_separated"],
      response_target: "Same-day review during staffed hours",
      evidence_count: 0,
      updates: [],
      resolution_code: null,
      support: { emergency: { number: "112", note: "Italy: 112." }, note: "We never contact the reported member with your identity." },
    },
  ],
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
  // The list read `state` and `opened_at`, which case_payload() does not return, so it showed
  // an empty badge and the literal text "Invalid Date".
  expect(s.hasText("Received and triaged")).toBe(true);
  expect(s.joined()).toContain("SR-7Q2F");
  expect(s.joined()).not.toContain("Invalid Date");
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

test("retrying a failed unblock retries the unblock, not the safety query", async () => {
  // The retry callback used to refetch /safety, so "Try again" left the person blocked and
  // the error on screen.
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const offline = Object.assign(new Error("You appear to be offline. Nothing was lost."), {
    status: 0,
    body: { code: "OFFLINE", message: "You appear to be offline. Nothing was lost.", retryable: true },
  });
  mockDel.mockRejectedValueOnce(offline);
  const s = await renderScreen(<SafetyCentre />);
  await s.press("Unblock");
  (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[]).find((b) => b.text === "Unblock")?.onPress?.();
  await s.settle();
  expect(s.joined()).toContain("You appear to be offline");

  mockDel.mockResolvedValueOnce(undefined);
  await s.press("Try again");
  // Two DELETEs for the same member: the first failed, the retry repeated it.
  expect(mockDel.mock.calls.filter(([p]) => String(p).startsWith("/blocks/"))).toHaveLength(2);
  expect(s.joined()).not.toContain("You appear to be offline");
});

test("one unblock succeeding does not strand another's failure", async () => {
  // Rows other than the one spinning stay pressable, so two unblocks can be in flight at once.
  // Ana's success used to clear the block Ben's failure needed, leaving Ben's error on screen
  // with no "Try again" and Ben still blocked.
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const offline = Object.assign(new Error("You appear to be offline. Nothing was lost."), {
    status: 0,
    body: { code: "OFFLINE", message: "You appear to be offline. Nothing was lost.", retryable: true },
  });

  let finishAna: () => void = () => {};
  mockDel.mockImplementation((path: string) =>
    path === "/blocks/mem_a"
      ? new Promise<void>((resolve) => {
          finishAna = resolve;
        })
      : Promise.reject(offline),
  );

  const s = await renderScreen(<SafetyCentre />);
  const confirmLast = () =>
    (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[]).find((b) => b.text === "Unblock")?.onPress?.();

  // Ana's row first, and her request stays in flight.
  await s.press("Unblock", 0);
  confirmLast();
  await s.settle();
  // Then Ben's, which fails while Ana's is still open.
  await s.press("Unblock", 1);
  confirmLast();
  await s.settle();
  expect(s.joined()).toContain("You appear to be offline");

  // Ana now succeeds. Ben's failure is not hers to clear.
  finishAna();
  await s.settle();
  expect(s.joined()).toContain("You appear to be offline");
  expect(s.texts()).toContain("Try again");
  // Ben is still blocked, so his row is still there to retry from.
  expect(mockDel.mock.calls.map(([p]) => p)).toEqual(["/blocks/mem_a", "/blocks/mem_b"]);
});

test("two unblocks failing on the shared list component keeps both failures", async () => {
  // Same bug as above, in the extracted BlockList: this branch carried the earlier
  // single-value fix, not the per-member one, so a second failure overwrote the first.
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const offline = (who: string) =>
    Object.assign(new Error(`Could not unblock ${who}.`), {
      status: 0,
      body: { code: "OFFLINE", message: `Could not unblock ${who}.`, retryable: true },
    });
  mockDel.mockImplementation((path: string) => Promise.reject(offline(path === "/blocks/mem_a" ? "Ana" : "Ben")));

  const s = await renderScreen(<SafetyCentre />);
  const confirmLast = () =>
    (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[]).find((b) => b.text === "Unblock")?.onPress?.();

  await s.press("Unblock", 0);
  confirmLast();
  await s.settle();
  await s.press("Unblock", 1);
  confirmLast();
  await s.settle();

  expect(s.joined()).toContain("Could not unblock Ana");
  expect(s.joined()).toContain("Could not unblock Ben");
  expect(s.texts().filter((t) => t === "Try again")).toHaveLength(2);
});
