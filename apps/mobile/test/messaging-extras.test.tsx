import { renderScreen, routeGet } from "./render";

/**
 * The product promises in these screens are the kind that are easy to break by accident:
 * the assistant must never send on its own, ending a conversation must not tell the other
 * person why, and opening the inbox must mark things read without a member hunting for a
 * button. Each is pinned here.
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockReplace = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, body?: unknown, opts?: unknown) => mockPost(p, body, opts),
  del: jest.fn(),
  newIdempotencyKey: () => "idem_test",
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({ useRequireMember: () => ({ me: { id: "mem_me", locale: "en" } }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace }),
  useLocalSearchParams: () => ({ conversationId: "conv_1" }),
}));

import Assistant from "../app/(app)/messages/[conversationId]/assistant";
import CloseConversation from "../app/(app)/messages/[conversationId]/close";
import Notifications from "../app/(app)/notifications";

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockReplace.mockReset();
});

test("the assistant asks for a draft and sends nothing by itself", async () => {
  mockPost.mockResolvedValue({
    draft_id: "draft_1",
    text: "Your prompt about slow mornings stuck with me — what does a good Sunday look like?",
    requires_member_review: true,
    can_auto_send: false,
    provenance: "Drafted from your recent messages.",
  });
  const s = await renderScreen(<Assistant />);
  await s.press("Write me a draft");

  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost.mock.calls[0][0]).toBe("/conversations/conv_1/ai-drafts");
  // Asking for a draft must not post a message. If this ever fails, the app has started
  // sending words a member never approved.
  expect(mockPost).not.toHaveBeenCalledWith(
    expect.stringContaining("/messages"),
    expect.anything(),
    expect.anything(),
  );
  expect(s.hasText("Drafted from your recent messages.")).toBe(true);
});

test("sending the draft carries the draft id and one client id", async () => {
  mockPost.mockResolvedValue({
    draft_id: "draft_1",
    text: "A draft",
    requires_member_review: true,
    can_auto_send: false,
    provenance: "p",
  });
  const s = await renderScreen(<Assistant />);
  await s.press("Write me a draft");
  mockPost.mockResolvedValue({});
  await s.press("Send this");
  const [path, body] = mockPost.mock.calls.at(-1) as [string, Record<string, unknown>];
  expect(path).toBe("/conversations/conv_1/messages");
  expect(body).toMatchObject({ draft_id: "draft_1", client_message_id: "idem_test" });
});

test("a paid-only capability is stated, not reported as an error", async () => {
  const err = Object.assign(new Error("Matchmaker Pro"), { code: "FORBIDDEN" });
  mockPost.mockRejectedValue(err);
  const s = await renderScreen(<Assistant />);
  await s.press("Write me a draft");
  expect(s.hasText("Manual messaging is always free")).toBe(true);
});

test("ending a conversation sends a reason and can block in the same step", async () => {
  mockPost.mockResolvedValue({});
  const s = await renderScreen(<CloseConversation />);
  await s.press("End the conversation");
  const [path, body] = mockPost.mock.calls.at(-1) as [string, Record<string, unknown>];
  expect(path).toBe("/conversations/conv_1/close");
  expect(body).toMatchObject({ reason: "not_for_me", block: false, private_note: null });
  expect(mockReplace).toHaveBeenCalledWith("/messages");
});

test("opening the inbox marks everything read without asking", async () => {
  mockGet.mockImplementation(
    routeGet({
      "/notifications": {
        items: [
          {
            id: "n1",
            type: "introduction_published",
            group: "introductions",
            title: "A new introduction",
            body: "Someone we think you'd like.",
            deep_link: "/introductions",
            read_at: null,
            created_at: "2026-10-06T09:00:00Z",
          },
        ],
        unread: 1,
      },
    }),
  );
  mockPost.mockResolvedValue({ marked: 1 });
  const s = await renderScreen(<Notifications />);
  expect(s.hasText("A new introduction")).toBe(true);
  expect(mockPost).toHaveBeenCalledWith("/notifications/read", {}, undefined);
});
