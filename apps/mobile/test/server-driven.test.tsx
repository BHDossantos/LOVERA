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
  expect(awaitingServer({ isSuccess: false, isFetchedAfterMount: false })).toBe(true);
  expect(awaitingServer({ isSuccess: true, isFetchedAfterMount: true })).toBe(false);
  // Success from the cache, with no fetch since the screen opened: the answer may predate the
  // member's arrival, which is the case the whole policy exists for.
  expect(awaitingServer({ isSuccess: true, isFetchedAfterMount: false })).toBe(true);
});

test("a fetch that failed is not freshness, whether or not anything was cached", () => {
  // query-core computes isFetchedAfterMount as
  //   dataUpdateCount > initial.dataUpdateCount || errorUpdateCount > initial.errorUpdateCount
  // so a *failed* fetch satisfies it. Both error cases therefore have isFetchedAfterMount true and
  // are told apart only by whether there is data, which is exactly what `isSuccess` answers.
  //
  // A failed refetch over cached data: the stale answer and its actionable controls would otherwise
  // render under an error banner, which is worse than the bug this policy exists for.
  expect(awaitingServer({ isSuccess: false, isFetchedAfterMount: true })).toBe(true);
  // A failed *first* load, with nothing cached. This is the one the first version got wrong: it
  // tested `isRefetchError`, which is `isError && hasData` and so false here, and declared the
  // screen fresh. On the conversation screen that meant rendering with a null summary — `onHold`
  // and `ended` both false, the composer, End and date planning live on a thread whose state was
  // unknown, Block hidden because there was no subject id, and Report opening with no subject.
  // Nothing on that screen renders the summary's error either, so it looked loaded and was not.
  expect(awaitingServer({ isSuccess: false, isFetchedAfterMount: true })).toBe(true);
  // And it recovers: a retry that succeeds is fresh.
  expect(awaitingServer({ isSuccess: true, isFetchedAfterMount: true })).toBe(false);
});

test("a screen gated on a first load that failed shows the failure, not a spinner", () => {
  // `AwaitingServer` tested `isRefetchError`, which is false when there is no data, so a first-load
  // failure sat behind "Loading…" for ever with no error and no retry — on the nine screens that
  // return it early. `isError` covers both, and is still false during the retry so the spinner
  // comes back while it is in flight.
  const src = readFileSync(join(__dirname, "..", "src/components/ui.tsx"), "utf8");
  expect(src).toContain("if (!query.isError || query.isFetching) return <Loading label={label} />;");
  // And the three screens that gate in place rather than returning early.
  for (const rel of ["app/account/review.tsx", "app/(app)/introductions/index.tsx", "app/(app)/messages/index.tsx"]) {
    const inPlace = readFileSync(join(__dirname, "..", rel), "utf8");
    expect(inPlace).toContain("!q.isError && <Loading");
    expect(inPlace).not.toContain("!q.isRefetchError && <Loading");
  }
});

test.each(NOTIFICATION_SCREENS)("%s refetches what the server sent the member to see", (rel) => {
  const src = readFileSync(join(__dirname, "..", rel), "utf8");
  expect(src).toContain("...serverDriven");
  expect(src).toContain('from "@/lib/query"');
  // And guards the member, which is the other half of being a notification destination. These
  // queries are `enabled: !!me`, so a member whose session has gone never fetches, and the gate is
  // right to withhold an answer that never arrived — but without a guard nothing sends them to sign
  // in either, and the screen waits for ever. `account/review.tsx` used `useAuth` alone and did
  // exactly that.
  expect(src).toContain("useRequireMember");
});

test("submitting feedback drops the cached second-date outcome", () => {
  // Refetching on mount is not enough on its own here: the feedback screen navigates straight
  // to the outcome screen, so a cached answer paints for a frame before the refetch lands.
  const src = readFileSync(join(__dirname, "..", "app/(app)/dates/[dateId]/feedback.tsx"), "utf8");
  expect(src).toContain('queryKey: ["date-plan", dateId, "outcome"]');
});

test("a destination withholds the cached answer rather than rendering it", () => {
  // `awaitingServer` has to *gate* the data, not sit beside it as an extra spinner. On the screens
  // that render several branches off `q.data` instead of returning early, that means a derived
  // value that is null while waiting; on the conversation screen it means the early return, because
  // a null summary there made `onHold` and `ended` both false — the permissive reading of "I do not
  // know yet", which left the composer and End usable on a thread the server had closed or held and
  // turned every send into a CONFLICT.
  for (const rel of ["app/account/review.tsx", "app/(app)/introductions/index.tsx", "app/(app)/messages/index.tsx"]) {
    const src = readFileSync(join(__dirname, "..", rel), "utf8");
    expect(src).toContain("awaitingServer(q) ? null : q.data");
  }
  const conv = readFileSync(join(__dirname, "..", "app/(app)/messages/[conversationId].tsx"), "utf8");
  expect(conv).toContain("if (awaitingServer(summary)");
  // The old gate, which is false whenever anything is cached, must not be the one deciding this.
  expect(conv).not.toContain("if (summary.isLoading");
});

test("a gated screen that cannot refetch says so, and offers a way out", () => {
  // Excluding a failed refetch from freshness is right — the cached answer is from before the
  // member arrived — but it also means the gate never opens on its own. Gating on `awaitingServer`
  // and rendering only a spinner therefore turned a network failure into a permanent spinner with
  // no explanation and nothing to press. Every gated screen goes through `AwaitingServer`, which
  // shows the error and an unconditional retry instead.
  const ui = readFileSync(join(__dirname, "..", "src/components/ui.tsx"), "utf8");
  expect(ui).toContain("export function AwaitingServer");
  // Unconditional, unlike ErrorState's own button, which only appears for a retryable error.
  expect(ui).toMatch(/AwaitingServer[\s\S]*?query\.refetch\(\)/);

  for (const rel of [
    "app/safety/cases/[caseId].tsx",
    "app/(app)/introductions/[id]/mutual.tsx",
    "app/(app)/introductions/[id]/index.tsx",
    "app/(app)/introductions/waiting.tsx",
    "app/(app)/dates/[dateId].tsx",
    "app/(app)/dates/[dateId]/mutual-second-date.tsx",
    "app/(app)/dates/[dateId]/safety.tsx",
    "app/(app)/dates/[dateId]/feedback.tsx",
    "app/(app)/messages/[conversationId].tsx",
  ]) {
    const src = readFileSync(join(__dirname, "..", rel), "utf8");
    expect(src).toContain("<AwaitingServer");
    // The spinner must not be what a gated screen falls back to on its own any more.
    const gate = src.slice(src.indexOf("if (awaitingServer("));
    expect(gate.slice(0, 400)).not.toContain("<Loading");
  }

  // The three that render in place already show an ErrorState with a retry, so there the spinner
  // only has to stop competing with it — on a first load that failed as much as on a refetch.
  for (const rel of ["app/account/review.tsx", "app/(app)/introductions/index.tsx", "app/(app)/messages/index.tsx"]) {
    const src = readFileSync(join(__dirname, "..", rel), "utf8");
    expect(src).toContain("awaitingServer(q) && !q.isError && <Loading");
  }
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
