import { useRef } from "react";

/**
 * Query behaviour for a screen the server sent the member to.
 *
 * The client's default `staleTime` is 15 seconds, which is right for a screen somebody
 * navigated to themselves and wrong for one opened from a notification: the notification exists
 * *because* the server changed something, so a cached answer from before that change is the one
 * thing the screen must not show. It is how "you both said yes" could open a screen reading
 * "Not mutual yet", and how "you both want a second date" could show the earlier non-mutual
 * result.
 *
 * `refetchOnMount: "always"` is necessary and not sufficient, which is the part I got wrong the
 * first time. It starts a refetch but returns the cached data immediately, and `isLoading` is
 * `isPending && isFetching` — false whenever there is cached data. So the stale answer still
 * rendered until the request came back. `invalidateQueries` has the same shape: it marks an
 * entry stale, it does not drop it.
 *
 * So there are three parts, and all three are load-bearing:
 *   - refetch on mount, so the request happens at all;
 *   - `gcTime: 0`, so nothing survives the screen being closed and reopened;
 *   - `useAwaitingServer`, so the screen withholds an answer fetched before the member arrived.
 */
export const serverDriven = { staleTime: 0, gcTime: 0, refetchOnMount: "always" } as const;

/**
 * Whether this query's data arrived after the screen opened.
 *
 * This is the third attempt at the predicate and the first one that is a single question rather
 * than a conjunction of proxies for it. The two before it were both built on
 * `isFetchedAfterMount`, which query-core computes as
 *
 *     dataUpdateCount > initial.dataUpdateCount || errorUpdateCount > initial.errorUpdateCount
 *
 * so it is true for a fetch that *failed*, and every version therefore needed a second term to
 * subtract the failures again:
 *
 *   - `&& !isRefetchError` missed a failed *first* load, because `isRefetchError` is
 *     `isError && hasData` and so false when nothing was cached. The conversation screen then
 *     rendered with a null summary: `onHold` and `ended` both false — the permissive reading of
 *     "I do not know" — so the composer, End and date planning were live on a thread whose state
 *     was unknown, Block was hidden for want of a subject id, and Report opened with no subject.
 *   - `isSuccess &&` fixed that and broke the other end. The installed types are explicit:
 *     `QueryObserverRefetchErrorResult` has `isSuccess: false` with `data` still present, so one
 *     failed poll of the Messages list — it polls every 30 seconds — made the whole list stop
 *     being fresh and blanked it, replacing a perfectly good list of conversations with an error.
 *
 * `dataUpdatedAt` asks the question directly: it is "the timestamp for when the query most
 * recently returned the status as success" and an error does not move it (`errorUpdatedAt` does).
 * So one comparison against the moment the screen opened covers every case — a cached answer from
 * before the member arrived is not fresh, a first load that failed is not fresh, data that arrived
 * is fresh, and it *stays* fresh through a later failed poll, which is the only sensible answer for
 * a screen that already has the server's current answer on it.
 *
 * `>=` rather than `>`: the comparison is against the moment of the first render, so an answer that
 * lands in that same millisecond is this screen's answer. A *stale* entry cannot land there — it
 * was written when some other screen fetched it, earlier — while a fast success landing in it would
 * otherwise gate the screen for ever.
 */
export function freshSince(q: { dataUpdatedAt: number }, mountedAt: number) {
  return q.dataUpdatedAt >= mountedAt;
}

/**
 * True while a server-driven screen has nothing it is entitled to show yet.
 *
 * A hook, because the question is "since this screen opened" and nothing on the query result
 * records when that was. Call it once per query and keep the boolean: a second call would start a
 * second clock.
 */
export function useAwaitingServer(q: { dataUpdatedAt: number }) {
  const mountedAt = useRef(Date.now());
  return !freshSince(q, mountedAt.current);
}
