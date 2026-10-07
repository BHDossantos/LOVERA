import { Alert } from "react-native";
import { renderScreen, routeGet } from "./render";

/**
 * Three endpoints neither app called, each of which left a member unable to do something the
 * product told them to do:
 *
 *   PUT    /availability        date_ready lives here, and the editor was onboarding-only, so
 *                               readiness could be turned off and never back on — while Today
 *                               emitted a task asking members to turn it on.
 *   POST   /blocks              blocking required accusing somebody in a report first.
 *   DELETE /preferences/{key}   a preference could be set and changed but never cleared.
 */
const AVAILABILITY = {
  timezone: "Europe/Rome",
  recurring_windows: [{ day: "sat", part: "evening" }],
  date_styles: ["coffee"],
  date_ready: false,
  policy: "Coarse windows only.",
};
const CONVERSATION = {
  id: "conv_1",
  introduction_id: "intro_1",
  status: "active",
  public_reason: null,
  other: { member_id: "mem_them", display_name: "Ben", verified: true },
  last_message: null,
  unread: 0,
  date: null,
  opened_at: "2026-10-01T10:00:00Z",
  safety_hold: false,
  safety: { subject_id: "mem_them", blocked_by_you: false },
};

/**
 * What `summary()` returns once the conversation is over: `other` is neutralised — no name,
 * no photo, no id — which is a deliberate privacy decision. The safety target is carried
 * separately, because reading it off `other.member_id` meant an ended thread could neither
 * block nor report the person, and reporting afterwards is the ordinary case.
 */
const ENDED = {
  ...CONVERSATION,
  status: "closed",
  public_reason: "This conversation has ended.",
  other: { member_id: null, display_name: "Member unavailable", verified: false, media: [] },
  safety: { subject_id: "mem_them", blocked_by_you: false },
};
const PREFS = {
  tier_meaning: { must: "A hard gate." },
  available: [],
  preferences: [
    {
      id: "pref_1",
      key: "smoking",
      label: "Smoking",
      description: "Smoking habits you accept.",
      tier: "prefer",
      operator: "in",
      value: { in: ["never"] },
      options: [
        { value: "never", label: "Never" },
        { value: "socially", label: "Socially" },
      ],
      updated_at: "2026-10-01T10:00:00Z",
    },
    {
      id: "pref_2",
      key: "age_range",
      label: "Age range",
      description: "Ages you would date.",
      tier: "must",
      operator: "range",
      value: { min: 30, max: 45 },
      options: null,
      updated_at: "2026-10-01T10:00:00Z",
    },
  ],
};

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDel = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, b: unknown) => mockPost(p, b),
  put: (p: string, b: unknown) => mockPost(p, b),
  patch: (p: string, b: unknown) => mockPost(p, b),
  del: (p: string) => mockDel(p),
  newIdempotencyKey: () => "idem_test",
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({
  useRequireMember: () => ({ me: { id: "mem_me" } }),
  useAuth: () => ({ refresh: jest.fn() }),
  nextOnboardingPath: () => "/today",
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ conversationId: "conv_1" }),
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() }),
}));

import Conversation from "../app/(app)/messages/[conversationId]";
import Preferences from "../app/(app)/you/preferences";

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDel.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockPost.mockResolvedValue({});
  mockDel.mockResolvedValue(undefined);
});

test("a conversation offers block and report, with the context a reviewer needs", async () => {
  mockGet.mockImplementation(
    routeGet({ "/conversations/conv_1/messages": { items: [], next_cursor: null, has_more: false }, "/conversations/conv_1": CONVERSATION }),
  );
  const s = await renderScreen(<Conversation />);

  await s.press("Report");
  // Both the person and the conversation ride along, so the report is not a bare narrative.
  expect(mockPush).toHaveBeenCalledWith("/safety/report?conversation=conv_1&subject=mem_them");
});

test("blocking from the conversation sends POST /blocks and leaves the thread", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockGet.mockImplementation(
    routeGet({ "/conversations/conv_1/messages": { items: [], next_cursor: null, has_more: false }, "/conversations/conv_1": CONVERSATION }),
  );
  const s = await renderScreen(<Conversation />);

  await s.press("Block");
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  buttons.find((b) => b.text === "Block")?.onPress?.();
  await s.settle();

  expect(mockPost).toHaveBeenCalledWith("/blocks", { member_id: "mem_them" });
  // The conversation is over as far as the API is concerned, so staying on it would be a lie.
  expect(mockReplace).toHaveBeenCalledWith("/messages");
});

test("a preference can be cleared, and the four the API refuses are not offered", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockGet.mockImplementation(routeGet({ "/preferences": PREFS }));
  const s = await renderScreen(<Preferences />);

  // Each row's control is labelled "Change"; the preference name is a heading beside it.
  await s.press("Change", 0);
  expect(s.texts()).toContain("Stop using this preference");
  await s.press("Stop using this preference");
  (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[])
    .find((b) => b.text === "Stop using it")
    ?.onPress?.();
  await s.settle();
  expect(mockDel).toHaveBeenCalledWith("/preferences/smoking");
});

test("age range has no remove button, because the API would refuse it", async () => {
  // DELETE /preferences/age_range is a 409: eligibility preferences are set to Open, never
  // removed. A button that always fails is worse than no button.
  mockGet.mockImplementation(routeGet({ "/preferences": PREFS }));
  const s = await renderScreen(<Preferences />);
  await s.press("Change", 1);
  expect(s.joined()).toContain("Age range");
  expect(s.texts()).not.toContain("Stop using this preference");
});

const conversationRoutes = (summary: unknown) =>
  routeGet({ "/conversations/conv_1/messages": { items: [], next_cursor: null, has_more: false }, "/conversations/conv_1": summary });

test("an ended conversation can still report the person, with the subject attached", async () => {
  mockGet.mockImplementation(conversationRoutes(ENDED));
  const s = await renderScreen(<Conversation />);

  // The profile is gone, as it should be.
  expect(s.joined()).toContain("Member unavailable");
  expect(s.joined()).not.toContain("Ben");

  // The report is not. A report with no subject reaches a reviewer who cannot act on anybody.
  await s.press("Report");
  expect(mockPush).toHaveBeenCalledWith("/safety/report?conversation=conv_1&subject=mem_them");
});

test("an ended conversation can still block the person", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockGet.mockImplementation(conversationRoutes(ENDED));
  const s = await renderScreen(<Conversation />);

  await s.press("Block");
  (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[]).find((b) => b.text === "Block")?.onPress?.();
  await s.settle();
  expect(mockPost).toHaveBeenCalledWith("/blocks", { member_id: "mem_them" });
});

test("somebody already blocked is not offered a second Block", async () => {
  // Repeating an action already taken reads as if the first one did not work. Reporting stays,
  // because having blocked somebody is not a reason to be unable to report them.
  mockGet.mockImplementation(conversationRoutes({ ...ENDED, safety: { subject_id: "mem_them", blocked_by_you: true } }));
  const s = await renderScreen(<Conversation />);

  expect(s.joined()).toContain("Blocked. Undo it in the safety centre.");
  await expect(s.press("Block")).rejects.toThrow(/nothing pressable/);
  expect(s.texts()).toContain("Report");
});
