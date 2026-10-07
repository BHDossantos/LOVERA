import { act } from "react-test-renderer";
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
  // A signal the member has never answered. It has no row in `signals`, which is exactly why
  // the form could not offer it — and `missing_signal_keys` names only the viewer's own gaps.
  unanswered: [
    {
      key: "life_plan.relocation",
      category: "life_plan",
      label: "Relocation",
      special_category: false,
      options: [
        { value: "open", label: "Open to relocating" },
        { value: "no", label: "Not relocating" },
      ],
    },
  ],
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
      correctable: true,
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
  // A bare {} is not what any of these endpoints returns, and for /correction the difference
  // matters: `applied` decides whether the screen says the Blueprint changed.
  mockPost.mockImplementation((path: string) =>
    path.endsWith("/correction")
      ? Promise.resolve({ recorded: true, applied: true, message: "Thanks. Your Blueprint is updated." })
      : Promise.resolve({}),
  );
  mockGet.mockImplementation(routeGet({ "/introductions/intro_1": INTRO, "/blueprint/current": BLUEPRINT }));
});

/**
 * Lay out the card and its three sections. `y` values are relative to the card, as React Native
 * reports them, so the screen adds the card's own offset before comparing with the fold.
 */
async function layOut(
  s: Awaited<ReturnType<typeof renderScreen>>,
  card: number,
  tops: { reasons: number; friction: number; unknown: number },
) {
  await s.layout(0, card);
  await s.layout(1, tops.reasons);
  await s.layout(2, tops.friction);
  await s.layout(3, tops.unknown);
}

test("reports every section once they have all been on screen, and only once", async () => {
  const s = await renderScreen(<IntroductionDetail />);
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(0);

  await layOut(s, 0, { reasons: 0, friction: 120, unknown: 240 });
  const calls = posted("/introductions/intro_1/explanation-viewed");
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toEqual({ sections: ["friction", "reasons", "unknown"] });

  // Scrolling again must not report it a second time.
  await s.scroll(50);
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(1);
});

test("a section still below the fold is not reported as seen", async () => {
  // The card's top reaching the fold says nothing about the friction and the unknown, which sit
  // below the reasons. Naming all three because the card was measured overstated what was read.
  const s = await renderScreen(<IntroductionDetail />);
  await layOut(s, 0, { reasons: 0, friction: 5000, unknown: 5200 });
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(0);

  // Scroll until they are in view, and now there is nothing left to wait for.
  await s.scroll(5000);
  const calls = posted("/introductions/intro_1/explanation-viewed");
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toEqual({ sections: ["friction", "reasons", "unknown"] });
});

test("a member who reads only the reasons has only the reasons reported", async () => {
  // This is what the field means. Measuring the card and naming all three said the friction and
  // the unknown had been read whenever the top of the card came into view, which on a short
  // screen is most of the time.
  jest.useFakeTimers();
  try {
    const s = await renderScreen(<IntroductionDetail />);
    await layOut(s, 0, { reasons: 0, friction: 5000, unknown: 5200 });
    expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(0);

    // The member stops scrolling without ever reaching the other two.
    await act(async () => {
      jest.advanceTimersByTime(2_500);
    });
    const calls = posted("/introductions/intro_1/explanation-viewed");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ sections: ["reasons"] });
  } finally {
    jest.useRealTimers();
  }
});

test("reading on after a pause reports the sections that pause missed", async () => {
  // The latch the review found: the idle timer sent ["reasons"] and marked the whole screen
  // reported, so friction and unknown could never be named however far the member then read.
  // Two seconds of stillness is ordinary stop-and-read, which made it the common case.
  jest.useFakeTimers();
  try {
    const s = await renderScreen(<IntroductionDetail />);
    await layOut(s, 0, { reasons: 0, friction: 5000, unknown: 5200 });
    await act(async () => {
      jest.advanceTimersByTime(2_500);
    });
    let calls = posted("/introductions/intro_1/explanation-viewed");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ sections: ["reasons"] });

    // They carry on to the bottom. The cumulative set has to arrive, so the last thing the API
    // holds is the whole truth rather than the first two seconds of it.
    await s.scroll(5000);
    await act(async () => {
      jest.advanceTimersByTime(2_500);
    });
    calls = posted("/introductions/intro_1/explanation-viewed");
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual({ sections: ["friction", "reasons", "unknown"] });

    // And no more than that: every section is now accounted for.
    await s.scroll(6000);
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(2);
  } finally {
    jest.useRealTimers();
  }
});

test("nothing is reported for an explanation never scrolled to", async () => {
  // Reporting on mount would make this a second name for introduction_opened.
  const s = await renderScreen(<IntroductionDetail />);
  await layOut(s, 9000, { reasons: 0, friction: 120, unknown: 240 });
  expect(posted("/introductions/intro_1/explanation-viewed")).toHaveLength(0);
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
  expect(s.hasText("Your Blueprint is corrected")).toBe(true);
});

test("flagging without a value does not claim the Blueprint changed", async () => {
  // correct() skips correct_signal when there is no value, and nothing reads IntroCorrection
  // for matching — so the signal the member says is wrong stays live. Telling them it was
  // fixed is the one claim this product cannot afford to get wrong.
  mockPost.mockImplementation((path: string) =>
    path.endsWith("/correction")
      ? Promise.resolve({
          recorded: true,
          applied: false,
          message: "Noted for a reviewer. Your matching has not changed, because you didn't pick a replacement value — choose one if you want future introductions to use it.",
        })
      : Promise.resolve({}),
  );
  const s = await renderScreen(<IntroductionDetail />);
  await s.press("Correct something about me");
  await s.press("Sleep rhythm");
  await s.press("Correct my Blueprint");
  await s.settle();

  expect(s.joined()).toContain("On record, but nothing changed yet");
  expect(s.joined()).not.toContain("Your Blueprint is corrected");
});

test("a correction with a value says the Blueprint was corrected", async () => {
  mockPost.mockImplementation((path: string) =>
    path.endsWith("/correction")
      ? Promise.resolve({ recorded: true, applied: true, message: "Thanks. Your Blueprint is updated." })
      : Promise.resolve({}),
  );
  const s = await renderScreen(<IntroductionDetail />);
  await s.press("Correct something about me");
  await s.press("Sleep rhythm");
  await s.press("Early riser");
  await s.press("Correct my Blueprint");
  await s.settle();

  expect(s.joined()).toContain("Your Blueprint is corrected");
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

test("a signal the member has never answered can still be supplied", async () => {
  // `missing_signals` is computed when either participant lacks a signal, so it used to name
  // gaps on the other side — and when the gap was the viewer's own, the form built its list
  // from `signals` and silently omitted the one value they could actually supply.
  mockGet.mockImplementation(
    routeGet({
      "/introductions/intro_1": {
        ...INTRO,
        explanation: {
          ...INTRO.explanation,
          unknown: { ...INTRO.explanation.unknown, missing_signal_keys: ["life_plan.relocation"] },
        },
      },
      "/blueprint/current": BLUEPRINT,
    }),
  );
  const s = await renderScreen(<IntroductionDetail />);
  await s.press("Correct something about me");

  expect(s.hasText("Relocation")).toBe(true);
  expect(s.joined()).toContain("You haven't answered this one");

  await s.press("Relocation");
  await s.press("Open to relocating");
  await s.press("Correct my Blueprint");
  await s.settle();

  expect(mockPost).toHaveBeenCalledWith("/introductions/intro_1/correction", {
    signal_key: "life_plan.relocation",
    value: "open",
    note: null,
  });
});

test("a sensitive signal whose consent was withdrawn is not offered for correction", async () => {
  // The row is still returned — a member is entitled to see what we hold about them — but
  // correct_signal refuses to change it, so offering it here is a guaranteed 403. Filtering only
  // `unanswered` on the API side left exactly this hole.
  mockGet.mockImplementation(
    routeGet({
      "/introductions/intro_1": INTRO,
      "/blueprint/current": {
        ...BLUEPRINT,
        signals: [
          ...BLUEPRINT.signals,
          {
            key: "values.faith_importance",
            category: "values",
            label: "Faith in daily life",
            value: "central",
            value_label: "Central",
            confidence: "strong",
            evidence: null,
            member_corrected: true,
            freshness_at: null,
            special_category: true,
            correctable: false,
            options: [{ value: "central", label: "Central" }],
          },
        ],
      },
    }),
  );
  const s = await renderScreen(<IntroductionDetail />);
  await s.press("Correct something about me");

  expect(s.joined()).not.toContain("Faith in daily life");
  // And the ordinary ones are still there, so this is a filter and not an empty list.
  expect(s.hasText("Sleep rhythm")).toBe(true);
});
