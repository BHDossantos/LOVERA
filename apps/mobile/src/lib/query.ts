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
 * `isFetchedAfterMount` alone is not that question. query-core computes it as
 *
 *     dataUpdateCount > initial.dataUpdateCount || errorUpdateCount > initial.errorUpdateCount
 *
 * (queryObserver.js), so a fetch that *failed* satisfies it. Both halves of the question therefore
 * have to be asked, and `isSuccess` is the one that asks the second: status is `success` only when
 * what we hold came back from a request that worked.
 *
 * It took two goes to get this right, and the first wrong answer is worth keeping written down.
 * `isRefetchError` is exactly `isError && hasData`, so excluding *it* covered a failed refetch over
 * cached data and missed a failed first load entirely: nothing cached, `isRefetchError` false,
 * declared fresh. On the conversation screen that meant rendering with a null summary, where
 * `onHold` and `ended` are both false — the permissive reading of "I do not know" — so the
 * composer, End and date planning were live on a thread whose state was unknown, Block was hidden
 * for want of a subject id, and Report opened with no subject on it.
 *
 * `isSuccess && isFetchedAfterMount` answers all four cases without a special case: fresh data
 * arrived (fresh), a refetch failed over cached data (not fresh), a first load failed with nothing
 * cached (not fresh), and a retry succeeded (fresh again). A later background refetch keeps status
 * at `success`, so this does not flicker on every poll.
 */
export function isFresh(q: { isSuccess: boolean; isFetchedAfterMount: boolean }) {
  return q.isSuccess && q.isFetchedAfterMount;
}

/** True while a server-driven screen has nothing it is entitled to show yet. */
export function awaitingServer(q: { isSuccess: boolean; isFetchedAfterMount: boolean }) {
  return !isFresh(q);
}
