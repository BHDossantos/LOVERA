import { renderScreen, routeGet } from "./render";

/**
 * The blank box, and what replaces it.
 *
 * After a mutual yes both apps handed the member an empty message field, and "hey" is what
 * anybody writes when there is nothing specific to answer — which is where most conversations
 * die. The other person's prompt answers are specific by construction: they were written to be
 * replied to, and they chose them.
 *
 * Two properties matter more than the feature itself:
 *
 *   - the openers disappear once somebody has spoken, because still offering them would be
 *     suggesting the two of them ignore each other;
 *   - a reply carries the prompt key to the server, which validates it against what the other
 *     person really wrote. The quote renders as *their* words, so a client-supplied quote would
 *     let anybody fabricate a line inside their own conversation.
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: (p: string, b: unknown) => mockPost(p, b),
  patch: jest.fn(),
  del: jest.fn(),
  newIdempotencyKey: () => "cid-test-0001",
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

import Conversation from "../app/(app)/messages/[conversationId]";

const CONVERSATION = {
  id: "conv_1",
  introduction_id: "intro_1",
  status: "active",
  public_reason: null,
  other: { member_id: "mem_them", display_name: "Ben", verified: true, media: [] },
  last_message: null,
  your_turn: true,
  unread: 0,
  date: null,
  opened_at: "2026-10-01T10:00:00Z",
  safety_hold: false,
  safety: { subject_id: "mem_them", blocked_by_you: false },
};

const OPENERS = {
  items: [
    { key: "second_date", label: "A second date I'd say yes to looks like", answer: "Something outdoors with good coffee." },
    { key: "repair", label: "After a disagreement, I", answer: "Say what I felt, then listen." },
  ],
};

const message = (over: Record<string, unknown> = {}) => ({
  id: "msg_1",
  client_message_id: "cid-1",
  sequence: 1,
  sender_id: "mem_them",
  mine: false,
  type: "text",
  text: "Thursday works for me.",
  moderation_state: "clear",
  meta: {},
  sent_at: "2026-10-02T10:00:00Z",
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue(message({ mine: true, sender_id: "mem_me" }));
});

describe("Opening a conversation nobody has spoken in", () => {
  it("offers the other person's own prompt answers", async () => {
    mockGet.mockImplementation(
      routeGet({
        "/conversations/conv_1/openers": OPENERS,
        "/conversations/conv_1/messages": { items: [], next_cursor: null, has_more: false },
        "/conversations/conv_1": CONVERSATION,
      }),
    );
    const s = await renderScreen(<Conversation />);

    expect(s.hasText("Something to open with")).toBe(true);
    expect(s.hasText("Something outdoors with good coffee.")).toBe(true);
    expect(s.hasText("A second date I'd say yes to looks like")).toBe(true);
  });

  it("sends the prompt key, so the server can check the quote is really theirs", async () => {
    mockGet.mockImplementation(
      routeGet({
        "/conversations/conv_1/openers": OPENERS,
        "/conversations/conv_1/messages": { items: [], next_cursor: null, has_more: false },
        "/conversations/conv_1": CONVERSATION,
      }),
    );
    const s = await renderScreen(<Conversation />);

    await s.press("Something outdoors with good coffee.");
    await s.type("Where is the good coffee, then?");
    await s.press("Send");

    expect(mockPost).toHaveBeenCalledWith("/conversations/conv_1/messages", {
      client_message_id: "cid-test-0001",
      text: "Where is the good coffee, then?",
      prompt_key: "second_date",
    });
  });

  it("still lets somebody ignore all of it and write their own", async () => {
    mockGet.mockImplementation(
      routeGet({
        "/conversations/conv_1/openers": OPENERS,
        "/conversations/conv_1/messages": { items: [], next_cursor: null, has_more: false },
        "/conversations/conv_1": CONVERSATION,
      }),
    );
    const s = await renderScreen(<Conversation />);

    await s.type("Hello — I liked your photo of the market.");
    await s.press("Send");

    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.prompt_key).toBeUndefined();
  });

  it("stops offering openers once there is a conversation to continue", async () => {
    mockGet.mockImplementation(
      routeGet({
        "/conversations/conv_1/openers": OPENERS,
        "/conversations/conv_1/messages": { items: [message()], next_cursor: null, has_more: false },
        "/conversations/conv_1": CONVERSATION,
      }),
    );
    const s = await renderScreen(<Conversation />);

    expect(s.texts().join(" ")).not.toContain("Something to open with");
  });

  it("shows the quote above a reply, so it reads as an answer to something", async () => {
    mockGet.mockImplementation(
      routeGet({
        "/conversations/conv_1/openers": OPENERS,
        "/conversations/conv_1/messages": {
          items: [
            message({
              mine: true,
              sender_id: "mem_me",
              text: "Where is the good coffee, then?",
              replying_to: { key: "second_date", label: "A second date I'd say yes to looks like", answer: "Something outdoors with good coffee." },
            }),
          ],
          next_cursor: null,
          has_more: false,
        },
        "/conversations/conv_1": CONVERSATION,
      }),
    );
    const s = await renderScreen(<Conversation />);

    expect(s.hasText("Something outdoors with good coffee.")).toBe(true);
    expect(s.hasText("Where is the good coffee, then?")).toBe(true);
  });

  it("renders the thread even if the openers endpoint answers something unexpected", async () => {
    // One optional endpoint returning a shape nobody planned for must not blank the screen the
    // member came for.
    mockGet.mockImplementation(
      routeGet({
        "/conversations/conv_1/openers": {},
        "/conversations/conv_1/messages": { items: [message()], next_cursor: null, has_more: false },
        "/conversations/conv_1": CONVERSATION,
      }),
    );
    const s = await renderScreen(<Conversation />);
    expect(s.hasText("Thursday works for me.")).toBe(true);
  });
});
