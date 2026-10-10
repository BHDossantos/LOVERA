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

/**
 * The purchase layer is mocked rather than the native module, because what this screen must get
 * right is the *decision*: offer a purchase only when every precondition holds, and otherwise say
 * so without a dead button and without a link to a web checkout — which is the one thing
 * guideline 3.1.1 explicitly prohibits.
 */
const mockPurchase = jest.fn();
const mockRestore = jest.fn();
let mockStoreAvailable: { available: boolean; reason?: string } = { available: false, reason: "Memberships cannot be bought in the app yet." };
let mockStoreProducts: { productId: string; priceLabel: string }[] = [];
jest.mock("@/lib/purchases", () => ({
  availability: () => mockStoreAvailable,
  configure: () => true,
  products: () => Promise.resolve(mockStoreProducts),
  purchase: (id: string) => mockPurchase(id),
  restore: () => mockRestore(),
}));

import Membership from "../app/(app)/you/membership";
import VerificationCentre from "../app/(app)/you/verification";

const prices = (monthly: number) => ({
  monthly: { cents: monthly, monthly_equivalent_cents: monthly, period_days: 30 },
  annual: { cents: monthly * 10, monthly_equivalent_cents: Math.round((monthly * 10) / 12), period_days: 365 },
});

const PLANS = {
  cadences: ["monthly", "annual"],
  renewal_terms: "Renews until you cancel.",
  principles: ["No boosts, super-likes or pay-to-reach."],
  store: { enabled: false, validation: "disabled", reason: "In-app purchase is not configured for this deployment yet.", products: {} },
  plans: [
    { id: "free", name: "Verified", tagline: "See how we match.", currency: "EUR", weekly_intro_cap: 1, features: [], included: ["Verified profile"], not_included: ["Weekly curated introductions"], prices: prices(0), store_product_ids: { monthly: null, annual: null }, annual_saving_cents: 0, price_cents: 0 },
    { id: "pro", name: "Matchmaker Pro", tagline: "The whole method.", currency: "EUR", weekly_intro_cap: 3, features: ["weekly_introductions", "ai_wingman"], included: ["Weekly curated introductions", "AI Wingman drafts"], not_included: ["Human matchmaker review", "Boosts"], prices: prices(3900), store_product_ids: { monthly: "pro_monthly", annual: "pro_annual" }, annual_saving_cents: 7800, price_cents: 3900 },
    { id: "concierge", name: "Concierge", tagline: "With a person watching.", currency: "EUR", weekly_intro_cap: 3, features: ["weekly_introductions", "ai_wingman", "human_review"], included: ["Weekly curated introductions", "AI Wingman drafts", "Human matchmaker review"], not_included: ["Boosts"], prices: prices(8900), store_product_ids: { monthly: "concierge_monthly", annual: "concierge_annual" }, annual_saving_cents: 17800, price_cents: 8900 },
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
  weekly_introductions: false,
  human_review: false,
  priority_coordination: false,
  protected_credits: 0,
  earns_protected_credits: false,
  cadence: "monthly",
  price_cents: 0,
  currency: "EUR",
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
  mockPurchase.mockReset();
  mockRestore.mockReset();
  mockStoreAvailable = { available: false, reason: "Memberships cannot be bought in the app yet." };
  mockStoreProducts = [];
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
    expect(s.hasText("Concierge")).toBe(true);
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
    expect(s.joined()).toContain("Memberships cannot be bought in the app yet");
  });

  it("offers a purchase at the store's own price once everything is configured", async () => {
    mockStoreAvailable = { available: true };
    mockStoreProducts = [
      { productId: "pro_monthly", priceLabel: "£34.99" },
      { productId: "pro_annual", priceLabel: "£349.99" },
    ];
    mockPurchase.mockResolvedValue({ ok: true, entitlementsChanged: true });
    billing(entitlements());
    const s = await renderScreen(<Membership />);

    // The store's price string, not our catalog's euros: the member is charged in their own
    // storefront's currency, after their store's tax, and the catalog knows neither.
    expect(s.joined()).toContain("£34.99 a month");
    await s.press("£34.99 a month");
    expect(mockPurchase).toHaveBeenCalledWith("pro_monthly");
  });

  it("offers no button for a product the store has no price for", async () => {
    // Concierge exists in the catalog but has not been created in App Store Connect yet. A
    // purchase button for it would fail at the store, which is a guideline 2.1 rejection.
    mockStoreAvailable = { available: true };
    mockStoreProducts = [{ productId: "pro_monthly", priceLabel: "£34.99" }];
    billing(entitlements());
    const s = await renderScreen(<Membership />);
    expect(s.joined()).toContain("£34.99 a month");
    expect(s.texts().join(" ")).not.toContain("concierge_monthly");
  });

  it("offers restore, which Apple requires and which recovers a lost receipt", async () => {
    mockStoreAvailable = { available: true };
    mockStoreProducts = [{ productId: "pro_monthly", priceLabel: "£34.99" }];
    mockRestore.mockResolvedValue({ ok: true, entitlementsChanged: true });
    billing(entitlements());
    const s = await renderScreen(<Membership />);
    await s.press("Restore purchases");
    expect(mockRestore).toHaveBeenCalled();
  });

  it("never turns a cancelled purchase into an error", async () => {
    mockStoreAvailable = { available: true };
    mockStoreProducts = [{ productId: "pro_monthly", priceLabel: "£34.99" }];
    mockPurchase.mockResolvedValue({ ok: false, cancelled: true });
    billing(entitlements());
    const s = await renderScreen(<Membership />);
    await s.press("£34.99 a month");
    expect(s.texts().join(" ")).not.toContain("About your purchase");
  });

  it("tells a member who was charged how to recover, rather than losing it", async () => {
    mockStoreAvailable = { available: true };
    mockStoreProducts = [{ productId: "pro_monthly", priceLabel: "£34.99" }];
    mockPurchase.mockResolvedValue({ ok: false, cancelled: false, message: "Your purchase went through but we could not record it. Use Restore purchases to finish." });
    billing(entitlements());
    const s = await renderScreen(<Membership />);
    await s.press("£34.99 a month");
    expect(s.joined()).toContain("Use Restore purchases to finish");
  });

  it("shows the annual price as money, with what it works out at per month", async () => {
    billing(entitlements());
    const s = await renderScreen(<Membership />);
    const text = s.joined();
    // The saving stated in euros rather than as a percentage of a base nobody says out loud.
    expect(text).toContain("Or €390 a year");
    expect(text).toContain("€33 a month, billed once");
    expect(text).toContain("ten months for twelve");
    expect(text).toContain("saving €78");
  });

  it("shows what the dearer tier buys that the cheaper one does not", async () => {
    // The defect this screen existed through: Concierge cost more than twice Pro and granted
    // exactly the same thing. A comparison built from each plan's own feature list is what makes
    // that impossible to ship again unnoticed.
    billing(entitlements());
    const s = await renderScreen(<Membership />);
    expect(s.hasText("Human matchmaker review")).toBe(true);
    expect(s.hasText("Compare")).toBe(true);
  });

  it("shows a paying member the price they actually agreed to, not today's", async () => {
    billing(entitlements({ plan: "pro", plan_name: "Matchmaker Pro", paid: true, status: "active", cadence: "annual", price_cents: 33000, renews_at: "2027-01-01T10:00:00Z" }));
    const s = await renderScreen(<Membership />);
    expect(s.joined()).toContain("€330 / year");
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
