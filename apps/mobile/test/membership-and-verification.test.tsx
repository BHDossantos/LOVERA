import { renderScreen } from "./render";

/**
 * The two You screens the phone did not have, and the two decisions inside them that are easy to
 * get wrong in opposite directions.
 *
 * **Membership must not sell anything.** Apple guideline 3.1.1 requires in-app purchase for a
 * digital subscription, there is no StoreKit here, and a link out to the web checkout is the
 * specific thing the guideline prohibits. So the screen has to show the paid plan honestly and
 * offer no way to buy it — while still letting somebody who already pays see their plan and cancel,
 * which is the half that was actually missing from the phone.
 *
 * **Verification must warn before it bites.** Verification expires on a timer, and when it does,
 * introductions pause. A member who first hears about that on the day it happens has already lost a
 * week. The You tab showed the status as a badge with nothing beside it to press, which is the same
 * dead end this app has already been fixed for twice.
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, b: unknown) => mockPost(p, b),
  patch: jest.fn(),
  del: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({
  useRequireMember: () => ({ me: { id: "mem_me" } }),
  useAuth: () => ({ me: { id: "mem_me" }, refresh: jest.fn(), signOut: jest.fn() }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ conversationId: "conv_1" }),
  useFocusEffect: () => {},
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

import Membership from "../app/(app)/you/membership";
import VerificationCentre from "../app/(app)/you/verification";

const PLANS = {
  renewal_terms: "Monthly, cancel any time.",
  principles: ["No boosts, super-likes or pay-to-reach."],
  plans: [
    { id: "free", name: "Verified", price_cents: 0, currency: "EUR", cadence: "monthly", weekly_intro_cap: 1, included: ["Verified profile"], not_included: ["Weekly curated introductions"] },
    { id: "pro", name: "Matchmaker Pro", price_cents: 3900, currency: "EUR", cadence: "monthly", weekly_intro_cap: 3, included: ["Weekly curated introductions"], not_included: ["Boosts"] },
  ],
};

const entitlements = (over: Record<string, unknown> = {}) => ({
  plan: "free",
  plan_name: "Verified",
  paid: false,
  weekly_intro_cap: 1,
  trial_introductions_remaining: 1,
  ai_wingman: false,
  translation: false,
  date_concierge: false,
  adaptive_refresh: false,
  travel_mode: false,
  dating_passport: false,
  protected_credits: 0,
  safety_tools: true,
  messaging: true,
  manual_date_planning: true,
  renews_at: null,
  cancel_at_period_end: false,
  status: "none",
  ...over,
});

const status = (over: Record<string, unknown> = {}) => ({
  status: "verified",
  mode: "manual_review",
  verified_at: "2026-01-01T10:00:00Z",
  expires_at: "2027-01-01T10:00:00Z",
  age_over_18: true,
  liveness_passed: true,
  failure_reason_code: null,
  badges: [{ key: "identity", label: "Identity checked", limits: "Confirms a real government ID matched a live selfie at verification time. Not a background check." }],
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

function billing(ent: Record<string, unknown>, ledger: unknown[] = []) {
  mockGet.mockImplementation((p: string) => {
    if (p === "/plans") return Promise.resolve(PLANS);
    if (p === "/subscriptions/current") return Promise.resolve({ entitlements: ent, ledger });
    return Promise.reject(new Error(`unexpected GET ${p}`));
  });
}

describe("Membership", () => {
  it("shows the paid plan to a free member but offers no way to buy it", async () => {
    billing(entitlements());
    const s = await renderScreen(<Membership />);

    expect(s.hasText("Matchmaker Pro")).toBe(true);
    expect(s.joined()).toContain("€39");
    // The compliance property, asserted as the absence of a purchase rather than the presence of
    // a disclaimer: no checkout call site, and no button a member could read as one.
    const labels = s.texts().join(" ").toLowerCase();
    expect(labels).not.toContain("start matchmaker pro");
    expect(labels).not.toContain("upgrade");
    expect(labels).not.toContain("subscribe");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("tells a free member why, rather than leaving a dead button", async () => {
    billing(entitlements());
    const s = await renderScreen(<Membership />);
    expect(s.joined()).toContain("not sold in the app");
  });

  it("lets a paying member see the plan they are on and cancel it", async () => {
    billing(entitlements({ plan: "pro", plan_name: "Matchmaker Pro", paid: true, status: "active", renews_at: "2026-11-01T10:00:00Z", protected_credits: 2 }));
    mockPost.mockResolvedValue({});
    const s = await renderScreen(<Membership />);

    expect(s.joined()).toContain("Your plan: Matchmaker Pro");
    expect(s.hasText("Weekly curated introductions")).toBe(true);

    await s.press("Cancel my membership");
    expect(s.hasText("Cancel your membership?")).toBe(true);
    await s.press("Cancel at the end of the period");
    expect(mockPost).toHaveBeenCalledWith("/subscriptions/cancel", { reason: "taking_a_break" });
  });

  it("does not offer cancelling twice to somebody who already cancelled", async () => {
    billing(entitlements({ plan: "pro", plan_name: "Matchmaker Pro", paid: true, status: "active", cancel_at_period_end: true, renews_at: "2026-11-01T10:00:00Z" }));
    const s = await renderScreen(<Membership />);
    expect(s.joined()).toContain("Cancelled");
    expect(s.texts().join(" ")).not.toContain("Cancel my membership");
  });
});

describe("Verification centre", () => {
  it("states what a badge does and does not claim", async () => {
    mockGet.mockResolvedValue(status());
    const s = await renderScreen(<VerificationCentre />);
    expect(s.hasText("Identity checked")).toBe(true);
    // The limits are the point. A badge that reads as a character reference is worse than none.
    expect(s.joined()).toContain("Not a background check");
  });

  it("warns before an expiry rather than after it", async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
    mockGet.mockResolvedValue(status({ expires_at: soon }));
    const s = await renderScreen(<VerificationCentre />);
    expect(s.hasText("Your verification expires soon")).toBe(true);
  });

  it("stays quiet when the expiry is a long way off", async () => {
    const later = new Date(Date.now() + 200 * 86_400_000).toISOString();
    mockGet.mockResolvedValue(status({ expires_at: later }));
    const s = await renderScreen(<VerificationCentre />);
    expect(s.texts().join(" ")).not.toContain("expires soon");
  });

  it("gives an expired member something to press, which the You badge never did", async () => {
    mockGet.mockResolvedValue(status({ status: "expired" }));
    mockPost.mockResolvedValue({ session: null, mode: "manual_review" });
    const s = await renderScreen(<VerificationCentre />);

    expect(s.hasText("Your verification has expired")).toBe(true);
    await s.press("Ask our team to verify you");
    expect(mockPost).toHaveBeenCalledWith("/verification/sessions", undefined);
  });

  it("offers a person to a member the automated check refused", async () => {
    mockGet.mockResolvedValue(status({ status: "failed", failure_reason_code: "no_match", badges: [] }));
    mockPost.mockResolvedValue({});
    const s = await renderScreen(<VerificationCentre />);

    expect(s.joined()).toContain("no_match");
    await s.press("Request human review");
    expect(mockPost).toHaveBeenCalledWith("/verification/review-request", { note: "" });
  });

  it("does not ask a member already in the queue to join it again", async () => {
    mockGet.mockResolvedValue(status({ status: "review_required" }));
    const s = await renderScreen(<VerificationCentre />);
    expect(s.hasText("A person will look at your verification")).toBe(true);
    expect(s.texts().join(" ")).not.toContain("Ask our team to verify you");
  });
});
