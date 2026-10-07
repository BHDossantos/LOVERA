import { apiFailure, renderScreen, routeGet } from "./render";

/**
 * Consent is the lawful basis for a sensitive criterion, so changing it changes the preferences
 * and blueprint payloads too — both cached, and either may be mounted in the stack behind the
 * privacy screen. Invalidating only `consents` left them contradicting the server: an active Must
 * and a live Change control on a criterion the matcher had just stopped applying.
 */
const CONSENTS = {
  purposes: ["special_category", "ai_processing"],
  consents: {
    special_category: { status: "granted", policy_version: "2026-01-01", changed_at: null },
    ai_processing: { status: "granted", policy_version: "2026-01-01", changed_at: null },
  },
};

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, b?: unknown, o?: unknown) => mockPost(p, b, o),
  put: (p: string, b?: unknown) => mockPut(p, b),
  del: jest.fn(),
  newIdempotencyKey: () => "idem_test",
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({
  useRequireMember: () => ({ me: { id: "mem_me", locale: "en" } }),
  useAuth: () => ({ me: { id: "mem_me" }, refresh: jest.fn(), signOut: jest.fn() }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ conversationId: "conv_1" }),
}));

import YouPrivacy from "../app/(app)/you/privacy";
import Messages from "../app/(app)/messages/index";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockPut.mockResolvedValue({});
});

test("changing a consent refreshes the payloads that depend on it", async () => {
  mockGet.mockImplementation(
    routeGet({ "/consents": CONSENTS, "/me/privacy": { requests: [], matching_data: [], never_in_matching: [] } }),
  );
  const s = await renderScreen(<YouPrivacy />);
  // What the preferences and blueprint screens would be holding behind this one.
  for (const key of [["preferences"], ["blueprint"]]) {
    s.client.setQueryDefaults(key, { gcTime: Infinity });
    s.client.setQueryData(key, { stale: true });
  }

  await s.toggle("Granted", false);

  expect(mockPut).toHaveBeenCalledWith("/consents/special_category", { status: "revoked" });
  // `preferences` gains an inactive row and loses faith from `available`; `blueprint` marks that
  // signal uncorrectable. Invalidating only `consents` left both contradicting the server.
  expect(s.client.getQueryState(["preferences"])?.isInvalidated).toBe(true);
  expect(s.client.getQueryState(["blueprint"])?.isInvalidated).toBe(true);
  // `consents` is not asserted: this screen observes it, so invalidating an active query
  // refetches at once and clears the flag — which is the behaviour we want, not a gap.
});


test("a failed poll does not take the conversation list away", async () => {
  /**
   * The Messages list polls every 30 seconds and nulls its data while it is not fresh, so what
   * "fresh" means decides whether one bad poll blanks a screen the member is reading.
   *
   * It did. The predicate asked `isSuccess`, and the installed types are explicit that
   * `QueryObserverRefetchErrorResult` has `isSuccess: false` with `data` still present — so a
   * transient failure of the poll replaced a correct list of conversations with an error, thirty
   * seconds after it had loaded, on a screen nobody had even touched. Freshness is now "did this
   * screen's own answer arrive", which a later failure cannot undo.
   */
  mockGet.mockImplementation(
    routeGet({
      "/conversations": {
        items: [
          { id: "conv_1", status: "active", other: { member_id: "mem_them", display_name: "Bruno", verified: true, media: [] }, last_message: { text: "Hello", at: "2026-10-01T10:00:00Z" }, unread_count: 0, date: null, safety: { subject_id: "mem_them", blocked_by_you: false } },
        ],
      },
    }),
  );
  const s = await renderScreen(<Messages />);
  expect(s.hasText("Bruno")).toBe(true);

  mockGet.mockImplementation(() => Promise.reject(apiFailure("The network is unavailable.")));
  await s.refetch(["conversations"]);

  // Still there, with the failure reported beside it rather than in place of it.
  expect(s.hasText("Bruno")).toBe(true);
  expect(s.hasText("The network is unavailable.")).toBe(true);
});
