import { renderScreen, routeGet } from "./render";

/**
 * Three properties worth pinning, each about a member's rights rather than a feature:
 * an adverse decision must be contestable from the app, a wrong inference must be
 * correctable, and the second-date result must not leak a rejection.
 */
const REVIEW = {
  status: "restricted",
  actions: [
    {
      id: "act_1",
      type: "restrict",
      reason_category: "harassment",
      notice: "Introductions are paused while we review a report about your messages.",
      starts_at: "2026-10-01T10:00:00Z",
      ends_at: null,
      active: true,
      decision_source: "human",
      appealable: true,
      appeal: null,
      evidence_types: ["member report", "conversation context"],
    },
  ],
  rights: ["Human review of any final adverse decision"],
};

const BLUEPRINT = {
  version: { id: "bp_1", version_no: 2, confirmed_at: "2026-09-01T10:00:00Z", model_version: "m1" },
  signals: [
    {
      key: "children",
      category: "life_plan",
      label: "Children",
      value: "open",
      value_label: "Open to it",
      confidence: "moderate",
      evidence: "From your interview answer.",
      member_corrected: false,
      freshness_at: "2026-09-01T10:00:00Z",
      special_category: false,
      // The API sends this on every signal; it is false only for a sensitive one whose consent
      // was withdrawn, which `correct_signal` refuses to change.
      correctable: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "open", label: "Open to it" },
        { value: "no", label: "No" },
      ],
    },
  ],
  coverage: { life_plan: 1, daily: 0, values: 0, interaction: 0, readiness: 0 },
  freshness: { age_days: 10, stale: false, refresh_after_days: 120 },
  data_use: "Blueprint signals are matching-only.",
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
jest.mock("@/lib/auth", () => ({
  useRequireMember: () => ({ me: { id: "mem_me", locale: "en" } }),
  useAuth: () => ({ me: { id: "mem_me", email: "me@example.test" }, signOut: jest.fn() }),
}));
jest.mock("expo-router", () => ({
  // The screens in the Tabs navigator are focused rather than remounted when a member comes
  // back to them, so the freshness clock resets on focus. The harness runs the callback once, as a
  // first focus would, and `refocus()` runs it again.
  useFocusEffect: (cb: () => void | (() => void)) => (require("./render") as { mockUseFocusEffect: (c: () => void | (() => void)) => void }).mockUseFocusEffect(cb),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ dateId: "dp_1" }),
}));

import AccountReview from "../app/account/review";
import YouBlueprint from "../app/(app)/you/blueprint";
import DateOutcome from "../app/(app)/dates/[dateId]/mutual-second-date";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

test("a restricted member can read the decision and appeal it from the app", async () => {
  mockGet.mockImplementation(routeGet({ "/account/review": REVIEW }));
  mockPost.mockResolvedValue({ appeal_id: "ap_1", status: "open" });
  const s = await renderScreen(<AccountReview />);
  expect(s.hasText("Introductions are paused while we review a report about your messages.")).toBe(true);
  // Decided by a person, not "human" — the label is for a member, not a database. React
  // splits that line across nodes, so it is asserted on the joined text.
  expect(s.joined()).toContain("decided by a person");

  await s.press("Appeal this decision");
  // The statement has a ten-character floor, so the send is disabled until there is one.
  await expect(s.press("Send my appeal")).rejects.toThrow(/disabled/);
  expect(mockPost).not.toHaveBeenCalled();
});

test("correcting a blueprint signal posts to that signal, marked as the member's own", async () => {
  mockGet.mockImplementation(routeGet({ "/blueprint/current": BLUEPRINT }));
  mockPost.mockResolvedValue({});
  const s = await renderScreen(<YouBlueprint />);
  expect(s.hasText("Open to it")).toBe(true);
  expect(s.hasText("From your interview answer.")).toBe(true);

  await s.press("That's not right");
  await s.press("No");
  await s.press("Save my correction");
  expect(mockPost).toHaveBeenCalledWith("/blueprint/signals/children", { tier: "must", value: { value: "no" } }, undefined);
});

test("a one-sided answer is indistinguishable from one that has not arrived", async () => {
  // The API returns the same state for "they said no" and "they have not answered", and the
  // screen must not add anything that could tell them apart.
  mockGet.mockImplementation(
    routeGet({
      "/date-plans/dp_1/mutual-outcome": {
        state: "no_mutual_result_yet",
        mutual: false,
        message: "You'll see a result here only if you both said yes.",
      },
    }),
  );
  const s = await renderScreen(<DateOutcome />);
  const shown = s.texts().join(" ").toLowerCase();
  expect(shown).toContain("only if you both said yes");
  for (const leak of ["said no", "declined", "not interested", "rejected", "passed on you"]) {
    expect(shown).not.toContain(leak);
  }
});

test("a mutual yes is stated plainly, with a way back to the conversation", async () => {
  mockGet.mockImplementation(
    routeGet({
      "/date-plans/dp_1/mutual-outcome": {
        state: "mutual_second_date",
        mutual: true,
        next_steps: ["Plan a second date from the chat"],
        conversation_id: "conv_1",
      },
    }),
  );
  const s = await renderScreen(<DateOutcome />);
  expect(s.hasText("You both said yes")).toBe(true);
  expect(s.hasText("Plan a second date from the chat")).toBe(true);
});

test("a sensitive signal whose consent was withdrawn says why it cannot be changed", async () => {
  mockGet.mockImplementation(
    routeGet({
      "/blueprint/current": {
        ...BLUEPRINT,
        signals: [
          {
            ...BLUEPRINT.signals[0],
            key: "values.faith_importance",
            label: "Faith in daily life",
            special_category: true,
            correctable: false,
          },
        ],
      },
    }),
  );
  const s = await renderScreen(<YouBlueprint />);
  // Still visible: a member is entitled to see what we hold about them.
  expect(s.hasText("Faith in daily life")).toBe(true);
  // But no control whose only outcome is a refusal.
  expect(s.texts()).not.toContain("That's not right");
  expect(s.joined()).toContain("cannot be changed here");
});
