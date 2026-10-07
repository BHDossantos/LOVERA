import { renderScreen, routeGet } from "./render";

/**
 * The two endpoints the introduction screen never called:
 *   POST /introductions/{id}/explanation-viewed
 *   POST /introductions/{id}/correction
 *
 * The second is the one that matters to a member: the explanation states the assumptions the
 * match was made on, and before this they could read an assumption that was wrong about them
 * and do nothing about it.
 */
const INTRO = {
  id: "intro_1",
  status: "offered",
  version: 3,
  conversation_id: null,
  expires_at: null,
  actions: { can_accept: true, can_decline: true, can_extend: false },
  profile: { display_name: "Ben", age: 38, city: "Rome", verified: true, media: [], prompts: [], bio: null },
  explanation: {
    reasons: [{ label: "Both want children", text: "You both said you want children.", strength: "strong" }],
    friction: { text: "They are an early riser and you are not.", strength: "mild" },
    unknown: { text: "Whether you make each other laugh.", strength: "unknown", missing_signal_keys: ["daily.sleep"] },
    data_categories: ["Blueprint signals", "Availability"],
  },
};
const BLUEPRINT = {
  version: null,
  coverage: {},
  freshness: { age_days: 2, stale: false, refresh_after_days: 180 },
  data_use: "Matching only.",
  signals: [
    {
      key: "daily.sleep",
      category: "daily",
      label: "Sleep rhythm",
      value: "night",
      value_label: "Night owl",
      confidence: "inferred",
      evidence: null,
      member_corrected: false,
      freshness_at: null,
      special_category: false,
      options: [
        { value: "early", label: "Early riser" },
        { value: "flexible", label: "Flexible" },
        { value: "night", label: "Night owl" },
      ],
    },
  ],
};

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, b: unknown) => mockPost(p, b),
  del: jest.fn(),
  newIdempotencyKey: () => "idem_test",
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({ useRequireMember: () => ({ me: { id: "mem_me" } }) }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "intro_1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

import IntroductionDetail from "../app/(app)/introductions/[id]/index";

const posted = (path: string) => mockPost.mock.calls.filter(([p]) => p === path);

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({});
  mockGet.mockImplementation(routeGet({ "/introductions/intro_1": INTRO, "/blueprint/current": BLUEPRINT }));
});

test("reports the explanation as viewed once it is actually on screen, and only once", async () => {
  const s = await renderScreen(<IntroductionDetail />);
  // onLayout is what tells the screen where the explanation sits; without it the screen has
  // no idea whether the member ever reached it, and must not claim they did.
  const card = s.tree.root.findAll((n) => typeof (n.props as { onLayout?: unknown }).onLayout === "function");
  expect(card.length).toBeGreaterThan(0);
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(0);

  await s.layout(0, 40);
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(1);
  expect(posted("/introductions/intro_1/explanation-viewed")[0][1]).toEqual({
    sections: ["reasons", "friction", "unknown"],
  });

  // Scrolling again must not report it a second time.
  await s.layout(0, 40);
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(1);
});

test("an explanation below the fold is not reported as viewed until it is reached", async () => {
  // Reporting on mount would make this signal a synonym for introduction_opened, which the
  // API already records separately. The point of it is to distinguish the two.
  const s = await renderScreen(<IntroductionDetail />);
  await s.layout(0, 4000);
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(0);

  await s.scroll(3800);
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(1);
});

test("a wrong assumption can be corrected, and the signal the matcher guessed comes first", async () => {
  const s = await renderScreen(<IntroductionDetail />);
  await s.press("Correct something about me");
  // The explanation named daily.sleep as the unknown, so that is the one offered.
  expect(s.hasText("Sleep rhythm")).toBe(true);
  expect(s.hasText("Currently: Night owl")).toBe(true);

  await s.press("Sleep rhythm");
  await s.press("Early riser");
  await s.press("Correct my Blueprint");
  await s.settle();

  expect(mockPost).toHaveBeenCalledWith("/introductions/intro_1/correction", {
    signal_key: "daily.sleep",
    value: "early",
    note: null,
  });
  expect(s.hasText("Correction recorded")).toBe(true);
});

test("a correction with no value still flags the signal", async () => {
  const s = await renderScreen(<IntroductionDetail />);
  await s.press("Correct something about me");
  await s.press("Sleep rhythm");
  await s.type("I work nights, so this is not a preference.", -1);
  await s.press("Correct my Blueprint");
  await s.settle();

  expect(mockPost).toHaveBeenCalledWith("/introductions/intro_1/correction", {
    signal_key: "daily.sleep",
    value: null,
    note: "I work nights, so this is not a preference.",
  });
});
