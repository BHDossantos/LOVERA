import { serverDriven } from "@/lib/query";

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
const { readFileSync } = require("fs") as { readFileSync(p: string, enc: "utf8"): string };
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
];

test("the policy is what it claims to be", () => {
  expect(serverDriven).toEqual({ staleTime: 0, refetchOnMount: "always" });
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
