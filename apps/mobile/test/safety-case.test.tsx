import { renderScreen, routeGet } from "./render";

/**
 * GET /safety/cases/{id} -> app/modules/safety/service.py::case_payload.
 *
 * This screen was written against `state`, `opened_at` and `updates[].text`. The API returns
 * `status`, `submitted_at` and `updates[].note`, so the member saw "Opened Invalid Date", an
 * empty status badge, and updates with no text in them — on the one screen that tells someone
 * their safety report is being handled.
 */
const CASE = {
  id: "case_1",
  receipt_code: "SR-7Q2F",
  category: "harassment",
  severity: "P2",
  status: "in_review",
  submitted_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-03T09:00:00Z",
  protection_applied: ["contact_separated"],
  response_target: "Same-day review during staffed hours",
  evidence_count: 1,
  updates: [{ at: "2026-10-02T11:00:00Z", note: "A reviewer has your report and has separated contact." }],
  resolution_code: null,
  support: { emergency: { number: "112", note: "Italy: 112." }, note: "We never contact the reported member with your identity." },
};

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, b: unknown) => mockPost(p, b),
  del: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({ useRequireMember: () => ({ me: { id: "mem_me" } }) }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ caseId: "case_1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

import CaseDetail from "../app/safety/cases/[caseId]";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockImplementation(routeGet({ "/safety/cases/case_1": CASE }));
});

test("shows the case as the API describes it, with no Invalid Date", async () => {
  const s = await renderScreen(<CaseDetail />);
  expect(s.joined()).toContain("SR-7Q2F");
  expect(s.hasText("Under review")).toBe(true);
  expect(s.joined()).toContain("Same-day review during staffed hours");
  expect(s.joined()).toContain("A reviewer has your report and has separated contact.");
  expect(s.joined()).toContain("Contact separated");
  expect(s.joined()).not.toContain("Invalid Date");
  expect(s.joined()).not.toContain("undefined");
});

test("a closed case says so instead of inviting notes it would reject", async () => {
  // add_evidence and the note route both 409 once the case is closed, so offering the forms
  // would be asking the member to type something that cannot be accepted.
  mockGet.mockImplementation(routeGet({ "/safety/cases/case_1": { ...CASE, status: "closed", resolution_code: "action_taken" } }));
  const s = await renderScreen(<CaseDetail />);
  expect(s.hasText("This case is closed")).toBe(true);
  expect(s.hasText("Closed")).toBe(true);
  expect(s.texts()).not.toContain("Add to the case");
  expect(s.texts()).not.toContain("Attach a screenshot");
});

test("adding a note posts it to the case and says it landed", async () => {
  mockPost.mockResolvedValue({});
  const s = await renderScreen(<CaseDetail />);
  // Nothing to send yet, so the control is not pressable — which is the behaviour we want.
  await expect(s.press("Add to the case")).rejects.toThrow(/disabled/);
  await s.type("He messaged me again from a new account.");
  await s.press("Add to the case");
  await s.settle();
  expect(mockPost).toHaveBeenCalledWith("/safety/cases/case_1/notes", {
    note: "He messaged me again from a new account.",
  });
  expect(s.hasText("Added. The reviewer will see it.")).toBe(true);
});
