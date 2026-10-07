import { renderScreen, routeGet } from "./render";

/**
 * The two date actions that could never succeed, now pinned.
 *
 * Confirming posted to /date-plans/{id}/confirm — a route that has never existed. Feedback
 * posted {second_date: boolean} when FeedbackIn requires `attendance` and names the field
 * `second_date_answer`, so it was rejected every time. Neither is visible to a typecheck or
 * a bundler: the first is a string, the second an object literal.
 */
const PLAN = {
  id: "dp_1",
  conversation_id: "conv_1",
  status: "proposed",
  timezone: "Europe/Rome",
  starts_at: "2026-10-12T18:00:00Z",
  ends_at: "2026-10-12T20:00:00Z",
  venue: null,
  date_style: "coffee",
  proposed_by_you: false,
  you_confirmed: false,
  awaiting_your_confirmation: true,
  other_display_name: "Ana",
  version: 3,
  history: [],
  cancellation_rules: "Cancel at least two hours ahead.",
  calendar_title: "Coffee",
  check_in: null,
  feedback_submitted: false,
  feedback_open: false,
  safety: { emergency: "112 (EU)", guidance: ["Meet in the public venue you both confirmed."] },
};

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, body?: unknown, opts?: unknown) => mockPost(p, body, opts),
  del: jest.fn(),
  newIdempotencyKey: () => "idem_test",
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({ useRequireMember: () => ({ me: { id: "mem_me" } }) }));
jest.mock("expo-router", () => ({
  // The screens in the Tabs navigator are focused rather than remounted when a member comes
  // back to them, so the freshness clock resets on focus. The harness runs the callback once, as a
  // first focus would, and `refocus()` runs it again.
  useFocusEffect: (cb: () => void | (() => void)) => (require("./render") as { mockUseFocusEffect: (c: () => void | (() => void)) => void }).mockUseFocusEffect(cb),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ dateId: "dp_1" }),
}));

import DateDetail from "../app/(app)/dates/[dateId]";
import DateFeedback from "../app/(app)/dates/[dateId]/feedback";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue(PLAN);
  mockGet.mockImplementation(routeGet({ "/date-plans/dp_1": PLAN }));
});

test("confirming a date posts to /respond with an action, not to a /confirm route", async () => {
  const s = await renderScreen(<DateDetail />);
  await s.press("Confirm this date");
  expect(mockPost).toHaveBeenCalledWith(
    "/date-plans/dp_1/respond",
    { action: "accept" },
    expect.objectContaining({ ifMatch: 3 }),
  );
  // The route that never existed.
  expect(mockPost).not.toHaveBeenCalledWith(expect.stringContaining("/confirm"), expect.anything(), expect.anything());
});

test("declining uses the same endpoint with the other action", async () => {
  const s = await renderScreen(<DateDetail />);
  await s.press("Decline");
  expect(mockPost).toHaveBeenCalledWith(
    "/date-plans/dp_1/respond",
    { action: "decline" },
    expect.objectContaining({ ifMatch: 3 }),
  );
});

test("feedback sends attendance, which the API requires and the old payload omitted", async () => {
  mockGet.mockImplementation(routeGet({ "/date-plans/dp_1": { ...PLAN, status: "confirmed", feedback_open: true } }));
  const s = await renderScreen(<DateFeedback />);
  // Default attendance is "We met", so the second-date question has to be answered first.
  await s.press("Yes");
  await s.press("Save my private answers");
  const [path, body] = mockPost.mock.calls.at(-1) as [string, Record<string, unknown>];
  expect(path).toBe("/date-plans/dp_1/feedback");
  expect(body).toHaveProperty("attendance", "attended");
  expect(body).toHaveProperty("second_date_answer");
  // The field the old screen sent, which FeedbackIn does not have.
  expect(body).not.toHaveProperty("second_date");
});

test("a no-show needs no second-date answer and still sends a valid payload", async () => {
  mockGet.mockImplementation(routeGet({ "/date-plans/dp_1": { ...PLAN, status: "confirmed", feedback_open: true } }));
  const s = await renderScreen(<DateFeedback />);
  await s.press("They didn't come");
  await s.press("Save my private answers");
  const [, body] = mockPost.mock.calls.at(-1) as [string, Record<string, unknown>];
  expect(body).toMatchObject({ attendance: "other_no_show", second_date_answer: null });
});
