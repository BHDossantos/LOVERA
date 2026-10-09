import { renderScreen } from "./render";

/**
 * Photos, which the phone has never actually shown anybody.
 *
 * `GET /v1/media/{id}` is authorized per viewer and answers with a `data:` URL in a `text/plain`
 * body. The introduction screen — the only screen in the app that rendered a photo at all — was
 * passing that relative path straight to `<Image source={{ uri }}>`, which React Native cannot
 * resolve and would not have sent the access token with anyway. The request never left the
 * handset, `<Image>` fails silently, and the result looked exactly like members not having
 * uploaded any photos. Nobody noticed because nothing threw.
 *
 * So the property worth pinning is not "a photo appears" — a test can make an image element exist
 * without any of this working. It is **that the fetch happens, with the right path**, and that
 * nothing hands a relative `/v1/...` string to an image. Both are asserted below.
 */
const mockGet = jest.fn();
const mockMediaDataUrl = jest.fn();
jest.mock("@/api/client", () => ({
  get: (p: string) => mockGet(p),
  post: jest.fn(),
  patch: jest.fn(),
  del: jest.fn(),
  mediaDataUrl: (p: string) => mockMediaDataUrl(p),
  ApiError: class extends Error {},
}));
jest.mock("@/lib/auth", () => ({
  useRequireMember: () => ({ me: { id: "mem_me" } }),
  useAuth: () => ({ me: { id: "mem_me" }, refresh: jest.fn(), signOut: jest.fn() }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
}));

import IntroductionsScreen from "../app/(app)/introductions/index";
import MessagesScreen from "../app/(app)/messages/index";

const PHOTO = { id: "med_1", type: "photo", url: "/v1/media/med_1", alt_text: null };

const profile = (over: Record<string, unknown> = {}) => ({
  member_id: "mem_other",
  display_name: "Giulia Rossi",
  age: 34,
  city: "Rome",
  distance_band_km: "under 5 km",
  verified: true,
  media: [PHOTO],
  ...over,
});

const intro = (over: Record<string, unknown> = {}) => ({
  id: "int_1",
  status: "offered",
  offered_at: null,
  expires_at: null,
  extension_available: false,
  is_trial: false,
  your_decision: null,
  mutual_interest_revealed: false,
  conversation_id: null,
  version: 1,
  actions: { can_accept: true, can_decline: true, can_extend: false, can_correct: false },
  privacy: "limited",
  profile: profile(),
  explanation: { reasons: [{ code: "r1", text: "You both want the same thing in the same city.", strength: "strong" }] },
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockMediaDataUrl.mockReset();
  mockMediaDataUrl.mockResolvedValue("data:image/png;base64,iVBORw0KGgo=");
});

/** Nothing anywhere in the tree may carry a bare API path as an image source. */
function imageSources(tree: { root: { findAll: (f: (n: { props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] } }) {
  return tree.root
    .findAll((n) => !!(n.props as { source?: { uri?: string } })?.source?.uri)
    .map((n) => (n.props as { source: { uri: string } }).source.uri);
}

describe("Introductions list", () => {
  it("fetches each photo through the authorized media endpoint", async () => {
    mockGet.mockResolvedValue({ current: [intro()], mutual: [], history: [], waiting: null });
    const s = await renderScreen(<IntroductionsScreen />);

    expect(mockMediaDataUrl).toHaveBeenCalledWith("/v1/media/med_1");
    expect(s.joined()).toContain("Giulia Rossi, 34");
  });

  it("never hands a relative API path to an image", async () => {
    mockGet.mockResolvedValue({ current: [intro()], mutual: [], history: [], waiting: null });
    const s = await renderScreen(<IntroductionsScreen />);
    for (const uri of imageSources(s.tree)) expect(uri.startsWith("data:")).toBe(true);
  });

  it("still renders the row when a member has no photo", async () => {
    mockGet.mockResolvedValue({ current: [intro({ profile: profile({ media: [] }) })], mutual: [], history: [], waiting: null });
    const s = await renderScreen(<IntroductionsScreen />);

    expect(mockMediaDataUrl).not.toHaveBeenCalled();
    // The initials stand in, so the row keeps its shape rather than collapsing around a gap.
    expect(s.hasText("GR")).toBe(true);
  });

  it("keeps the row readable when the photo cannot be loaded", async () => {
    mockMediaDataUrl.mockResolvedValue(null);
    mockGet.mockResolvedValue({ current: [intro()], mutual: [], history: [], waiting: null });
    const s = await renderScreen(<IntroductionsScreen />);

    // No banner, no thrown render: a photo that will not load is a degraded card, not an error.
    expect(s.joined()).toContain("Giulia Rossi, 34");
    expect(s.joined()).not.toContain("Something went wrong");
  });
});

describe("Conversations list", () => {
  const conversation = (other: Record<string, unknown>) => ({
    id: "conv_1",
    introduction_id: "int_1",
    status: "active",
    public_reason: null,
    other,
    last_message: { text: "Thursday works for me.", sent_at: "2026-10-01T10:00:00Z", mine: false },
    unread: 2,
    date: null,
    opened_at: "2026-10-01T09:00:00Z",
    safety_hold: false,
    safety: { subject_id: "mem_other", blocked_by_you: false },
  });

  it("fetches the other member's photo through the authorized endpoint", async () => {
    mockGet.mockResolvedValue({ items: [conversation(profile())] });
    const s = await renderScreen(<MessagesScreen />);

    expect(mockMediaDataUrl).toHaveBeenCalledWith("/v1/media/med_1");
    expect(s.hasText("Giulia Rossi")).toBe(true);
  });

  it("survives the neutralised snapshot a closed conversation carries", async () => {
    // Once a conversation closes, `other` loses its name, its photo and its id. A list that
    // assumed any of those would throw on exactly the rows a member is most likely to revisit.
    mockGet.mockResolvedValue({
      items: [conversation({ member_id: null, display_name: "Member unavailable", verified: false, media: [] })],
    });
    const s = await renderScreen(<MessagesScreen />);

    expect(s.hasText("Member unavailable")).toBe(true);
    expect(mockMediaDataUrl).not.toHaveBeenCalled();
  });
});
