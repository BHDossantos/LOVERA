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
 *   - `isFresh`, so the screen withholds an answer fetched before the member arrived.
 */
export const serverDriven = { staleTime: 0, gcTime: 0, refetchOnMount: "always" } as const;

/**
 * Whether this query's data was fetched *successfully* since the screen opened.
 *
 * `isFetchedAfterMount` alone is not that question, which is the second thing I got wrong here.
 * query-core computes it as
 *
 *     dataUpdateCount > initial.dataUpdateCount || errorUpdateCount > initial.errorUpdateCount
 *
 * (queryObserver.js), so a refetch that *failed* satisfies it. A notification destination holding
 * cached data whose refetch then fails would have been declared fresh and ungated — rendering the
 * stale answer, with its actionable controls, underneath an error banner. That is worse than the
 * bug this policy was written for, because now the screen looks wrong and acts live.
 *
 * `isRefetchError` is exactly `isError && hasData`: the refetch failed and what we hold is from
 * before. Excluding it leaves the four cases right — fresh data arrived (fresh), refetch failed
 * over cached data (not fresh, keep gating), first load failed with no data at all (nothing to
 * gate; the screen shows its error state), and a later retry succeeding (fresh again).
 *
 * Checking staleness instead would spin on every later background refetch, and checking
 * `isLoading` trusts whatever was in the cache.
 */
export function isFresh(q: { isFetchedAfterMount: boolean; isRefetchError: boolean }) {
  return q.isFetchedAfterMount && !q.isRefetchError;
}

/** True while a server-driven screen has nothing it is entitled to show yet. */
export function awaitingServer(q: { isLoading: boolean; isFetchedAfterMount: boolean; isRefetchError: boolean }) {
  return q.isLoading || !isFresh(q);
}
