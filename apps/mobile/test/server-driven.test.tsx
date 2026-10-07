import { awaitingServer, serverDriven } from "@/lib/query";

/**
 * The rule, asserted against the screens rather than remembered.
 *
 * Every screen a notification deep-links to must refetch on mount. The client's default
 * staleTime is 15s, which is right for a screen somebody navigated to themselves and wrong for
 * one the server sent them to: the notification exists *because* something changed, so a cached
 * answer from before that change is the one thing the screen must not show. That is how "you
 * both said yes" opened a screen reading "Not mutual yet", and how "you both want a second
 * date" could show the earlier non-mutual result.
 *
 * Checked by reading the sources, because the alternative is one of these regressing quietly
 * and being found a screen at a time.
 */
// Declared here rather than by adding "node" to tsconfig's `types`: that list is deliberately
// short so the app's own files cannot reach for node APIs, and this test is the only thing that
// needs them.
declare const __dirname: string;
declare function require(id: string): unknown;
const { readFileSync, readdirSync } = require("fs") as {
  readFileSync(p: string, enc: "utf8"): string;
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
};
const { join } = require("path") as { join(...parts: string[]): string };

/** The screens behind the `path` and `deep_link` values the API hands out. */
const NOTIFICATION_SCREENS = [
  "app/(app)/introductions/[id]/index.tsx",
  "app/(app)/introductions/[id]/mutual.tsx",
  "app/(app)/dates/[dateId].tsx",
  "app/(app)/dates/[dateId]/feedback.tsx",
  "app/(app)/dates/[dateId]/safety.tsx",
  "app/(app)/dates/[dateId]/mutual-second-date.tsx",
  "app/safety/cases/[caseId].tsx",
  "app/account/review.tsx",
  // The four an earlier hand-written version of this list left out, while the test passed and
  // claimed the policy covered every deep link: a protected credit points at
  // /introductions/waiting, a new message at /messages/{id}, a closed conversation at /messages,
  // and an expired introduction at /introductions.
  "app/(app)/introductions/waiting.tsx",
  "app/(app)/introductions/index.tsx",
  "app/(app)/messages/index.tsx",
  "app/(app)/messages/[conversationId].tsx",
];

/**
 * The paths the API actually deep-links to, read out of its source. Keeping the list above
 * honest is the point: a hand-written list that omits a destination still passes while claiming
 * full coverage, which is how four of them went missing.
 */
function apiDeepLinks(): string[] {
  const apiDir = join(__dirname, "..", "..", "api", "app");
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__pycache__") walk(p);
      } else if (entry.name.endsWith(".py")) {
        const text = readFileSync(p, "utf8");
        for (const line of text.split("\n")) {
          if (!/\bnotify\(|"(?:path|deep_link|cta_path|safety_shortcut)":/.test(line)) continue;
          for (const m of line.matchAll(/f?["'](\/[^"']*)["']/g)) out.add(m[1]);
        }
      }
    }
  };
  walk(apiDir);
  return [...out];
}

test("the policy is what it claims to be, and all three parts are load-bearing", () => {
  // refetchOnMount alone was not enough: it starts a refetch and returns the cached data, and
  // `isLoading` is false whenever there is cached data. gcTime drops the entry when the screen
  // closes; awaitingServer withholds an answer fetched before the member arrived.
  expect(serverDriven).toEqual({ staleTime: 0, gcTime: 0, refetchOnMount: "always" });
  expect(awaitingServer({ isLoading: false, isFetchedAfterMount: false })).toBe(true);
  expect(awaitingServer({ isLoading: false, isFetchedAfterMount: true })).toBe(false);
  expect(awaitingServer({ isLoading: true, isFetchedAfterMount: true })).toBe(true);
});

test.each(NOTIFICATION_SCREENS)("%s refetches what the server sent the member to see", (rel) => {
  const src = readFileSync(join(__dirname, "..", rel), "utf8");
  expect(src).toContain("...serverDriven");
  expect(src).toContain('from "@/lib/query"');
});

test("submitting feedback drops the cached second-date outcome", () => {
  // Refetching on mount is not enough on its own here: the feedback screen navigates straight
  // to the outcome screen, so a cached answer paints for a frame before the refetch lands.
  const src = readFileSync(join(__dirname, "..", "app/(app)/dates/[dateId]/feedback.tsx"), "utf8");
  expect(src).toContain('queryKey: ["date-plan", dateId, "outcome"]');
});

test("no notification destination is missing from the list above", () => {
  // Derived from the API source rather than remembered. A screen-state path the API hands out and
  // this list does not name is a destination still on the 15-second cache — which is how
  // /introductions/waiting, /messages, /messages/{id} and /introductions were all missed.
  const screenFor: Record<string, string> = {
    "/introductions": "app/(app)/introductions/index.tsx",
    "/introductions/waiting": "app/(app)/introductions/waiting.tsx",
    "/introductions/{}": "app/(app)/introductions/[id]/index.tsx",
    "/introductions/{}/mutual": "app/(app)/introductions/[id]/mutual.tsx",
    "/messages": "app/(app)/messages/index.tsx",
    "/messages/{}": "app/(app)/messages/[conversationId].tsx",
    "/dates/{}": "app/(app)/dates/[dateId].tsx",
    "/dates/{}/feedback": "app/(app)/dates/[dateId]/feedback.tsx",
    "/dates/{}/safety": "app/(app)/dates/[dateId]/safety.tsx",
    "/dates/{}/mutual-second-date": "app/(app)/dates/[dateId]/mutual-second-date.tsx",
    "/safety/cases/{}": "app/safety/cases/[caseId].tsx",
    "/account/review": "app/account/review.tsx",
  };
  // Destinations that are not a view of server state the notification changed: a form to fill in,
  // a hub, a list of the member's own settings. They have nothing stale to show.
  const notStateful = ["/safety", "/safety/report", "/safety/blocks", "/safety/cases", "/dates", "/you/", "/onboarding/"];

  const missing = apiDeepLinks()
    .map((p) => p.replace(/\{[^}]*\}/g, "{}"))
    .filter((p) => !notStateful.some((prefix) => p === prefix.replace(/\/$/, "") || p.startsWith(prefix)))
    .filter((p) => {
      const screen = screenFor[p];
      expect(screen).toBeDefined();
      return !NOTIFICATION_SCREENS.includes(screen);
    });
  expect(missing).toEqual([]);
});
