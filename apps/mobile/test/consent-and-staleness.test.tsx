import { renderScreen, routeGet } from "./render";

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
