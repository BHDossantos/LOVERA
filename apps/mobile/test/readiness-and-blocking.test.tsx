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
  recurring_windows: [{ weekday: 5, start: "18:00", end: "22:00" }],
  date_styles: ["coffee"],
  date_ready: false,
  updated_at: "2026-10-01T10:00:00Z",
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
const mockRefresh = jest.fn();
jest.mock("@/lib/auth", () => ({
  useRequireMember: () => ({ me: { id: "mem_me" } }),
  useAuth: () => ({ refresh: () => mockRefresh() }),
  nextOnboardingPath: () => "/today",
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ conversationId: "conv_1" }),
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() }),
}));

import Conversation from "../app/(app)/messages/[conversationId]";
import Preferences from "../app/(app)/you/preferences";
import YouAvailability from "../app/(app)/you/availability";

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDel.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockRefresh.mockReset();
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

test("blocking drops the cached date and introduction it has just cancelled", async () => {
  // `create_block` cancels every open date plan on the conversation and closes any open
  // introduction between the two (safety/service.py:46-54) — which is what the dialog promises.
  // Invalidating only conversations, blocks and Today left a mounted Dates tab or date detail
  // showing a confirmed date with the blocked member, Confirm and Check in still on it.
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockGet.mockImplementation(conversationRoutes(CONVERSATION));
  const s = await renderScreen(<Conversation />);

  // What another screen would be holding when the member blocks from here. The harness client
  // runs gcTime: 0, which collects an unobserved entry the moment it is written — so without
  // this the removals below would pass against code that removes nothing.
  for (const key of [["date-plan"], ["introduction"], ["date-plans"], ["introductions"]]) {
    s.client.setQueryDefaults(key, { gcTime: Infinity });
  }
  s.client.setQueryData(["date-plan", "dp_1"], { id: "dp_1", status: "confirmed" });
  s.client.setQueryData(["date-plan", "dp_1", "outcome"], { state: "no_mutual_result_yet" });
  s.client.setQueryData(["introduction", "intro_1"], { id: "intro_1", status: "mutual" });
  s.client.setQueryData(["date-plans"], { items: [{ id: "dp_1" }] });
  s.client.setQueryData(["introductions"], { current: [{ id: "intro_1" }], mutual: [] });

  await s.press("Block");
  (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[]).find((b) => b.text === "Block")?.onPress?.();
  await s.settle();

  // The details are gone, not merely stale: stale data is still painted.
  expect(s.client.getQueryData(["date-plan", "dp_1"])).toBeUndefined();
  expect(s.client.getQueryData(["date-plan", "dp_1", "outcome"])).toBeUndefined();
  expect(s.client.getQueryData(["introduction", "intro_1"])).toBeUndefined();
  // The lists are invalidated: a mounted one refetches at once, and a row is not an action.
  expect(s.client.getQueryState(["date-plans"])?.isInvalidated).toBe(true);
  expect(s.client.getQueryState(["introductions"])?.isInvalidated).toBe(true);
});

test("saving readiness refreshes Today, not only the member", async () => {
  // This screen is normally opened from Today's readiness task, so `router.back()` returns to a
  // Today that was never unmounted — `refetchOnMount` cannot fire, and it would go on offering
  // the task that has just been done until its next sixty-second poll.
  mockGet.mockImplementation(routeGet({ "/availability": AVAILABILITY }));
  const s = await renderScreen(<YouAvailability />);
  s.client.setQueryDefaults(["today"], { gcTime: Infinity });
  s.client.setQueryData(["today"], { tasks: [{ key: "set_availability", title: "Say when you could meet" }] });

  await s.press("Save my availability");
  await s.settle();

  expect(mockPost).toHaveBeenCalledWith("/availability", expect.objectContaining({ date_ready: expect.anything() }));
  expect(mockRefresh).toHaveBeenCalled();
  expect(s.client.getQueryState(["today"])?.isInvalidated).toBe(true);
});

test("a preference the matcher is ignoring can still be deleted", async () => {
  // Marking a withdrawn-consent preference inactive took away the Change button — and the only
  // route to the delete control was through that editor. So the member likeliest to want the
  // criterion gone was the one who had to re-grant the consent they withdrew in order to erase
  // it. `delete_preference` needs no consent; it refuses only the four eligibility criteria.
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockGet.mockImplementation(
    routeGet({
      "/preferences": {
        ...PREFS,
        preferences: [
          { ...PREFS.preferences[0], key: "faith_importance", label: "Faith in daily life", active: false, inactive_reason: "special_category_consent_withdrawn" },
        ],
      },
    }),
  );
  const s = await renderScreen(<Preferences />);
  expect(s.texts()).not.toContain("Change");

  await s.press("Delete this preference");
  (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[]).find((b) => b.text === "Stop using it")?.onPress?.();
  await s.settle();
  expect(mockDel).toHaveBeenCalledWith("/preferences/faith_importance");
});

test("an inactive eligibility criterion offers no delete, because the API refuses it", async () => {
  mockGet.mockImplementation(
    routeGet({
      "/preferences": {
        ...PREFS,
        preferences: [{ ...PREFS.preferences[1], active: false, inactive_reason: "special_category_consent_withdrawn" }],
      },
    }),
  );
  const s = await renderScreen(<Preferences />);
  expect(s.joined()).toContain("Age range");
  expect(s.texts()).not.toContain("Delete this preference");
});

test("a preference write refreshes the Blueprint, which embeds the same list", async () => {
  // `/blueprint/current` carries the preference list (`current_payload`), so a Blueprint screen
  // left mounted behind this one went on showing a criterion that had just been deleted or
  // retiered. Invalidating only `["preferences"]` reached the list the member was looking at and
  // not the copy on the screen they would go back to.
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockGet.mockImplementation(routeGet({ "/preferences": PREFS }));
  const s = await renderScreen(<Preferences />);
  // Only the Blueprint: this screen observes `["preferences"]`, so seeding that one would replace
  // the data it is rendering from.
  s.client.setQueryDefaults(["blueprint"], { gcTime: Infinity });
  s.client.setQueryData(["blueprint"], { signals: [], preferences: [{ key: "smoking" }] });

  await s.press("Change", 0);
  await s.press("Stop using this preference");
  (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[]).find((b) => b.text === "Stop using it")?.onPress?.();
  await s.settle();

  expect(mockDel).toHaveBeenCalledWith("/preferences/smoking");
  expect(s.client.getQueryState(["blueprint"])?.isInvalidated).toBe(true);
});

test("an empty stored style list is shown as empty, not silently filled in", async () => {
  // GET /availability returns date_styles: [] both for a member who never saved and for one whose
  // list is empty, so seeding "coffee" off `length` pre-selected a style on their behalf and the
  // next save of anything else wrote it back as theirs. `updated_at` is the only thing that tells
  // the two apart. Here it is set, so nothing is chosen for them — and because a style is required
  // to save, the screen asks rather than guesses.
  mockGet.mockImplementation(routeGet({ "/availability": { ...AVAILABILITY, date_styles: [], date_ready: true } }));
  const s = await renderScreen(<YouAvailability />);

  await expect(s.press("Save my availability")).rejects.toThrow(/disabled/);
  expect(mockPost.mock.calls.filter(([p]) => p === "/availability")).toHaveLength(0);

  // Choosing one is all it takes, and only the chosen one is sent.
  await s.press("Drinks");
  await s.press("Save my availability");
  await s.settle();
  const [, body] = mockPost.mock.calls.find(([p]) => p === "/availability")!;
  expect((body as { date_styles: string[] }).date_styles).toEqual(["drinks"]);
});

test("a member who has never saved availability still gets a sensible starting point", async () => {
  // The default is for onboarding, where there is nothing stored and an empty form is unhelpful.
  mockGet.mockImplementation(
    routeGet({ "/availability": { ...AVAILABILITY, recurring_windows: [], date_styles: [], updated_at: null } }),
  );
  const s = await renderScreen(<YouAvailability />);

  await s.press("Save my availability");
  await s.settle();

  const [, body] = mockPost.mock.calls.find(([p]) => p === "/availability")!;
  expect((body as { date_styles: string[] }).date_styles).toEqual(["coffee"]);
  expect((body as { recurring_windows: unknown[] }).recurring_windows.length).toBeGreaterThan(0);
});
