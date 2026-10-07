/**
 * Query options for a screen the server sent the member to.
 *
 * The client's default `staleTime` is 15 seconds, which is right for a screen somebody
 * navigated to themselves and wrong for one opened from a notification: the notification exists
 * *because* the server changed something, so a cached answer from before that change is the one
 * thing the screen must not show. It is how "you both said yes" could open a screen reading
 * "Not mutual yet", and how "you both want a second date" could show the earlier non-mutual
 * result.
 *
 * Applied to every screen a notification deep-links to, so this is a rule rather than a list of
 * places somebody remembered. The deep links are the `path` and `deep_link` values in
 * apps/api/app — the same set apps/mobile/scripts/check-routes.js checks.
 */
export const serverDriven = { staleTime: 0, refetchOnMount: "always" } as const;
