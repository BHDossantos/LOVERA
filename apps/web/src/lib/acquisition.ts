/**
 * Public links carry one bounded catalog code, never a URL, referrer or free-text UTM value.
 * This checks syntax only: the server decides whether a campaign is registered and active.
 * The code stays in the welcome URL through OTP retries/reloads; no browser storage is needed.
 */
export function validCampaignCode(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/.test(value) ? value : undefined;
}

export function campaignCodeFromSearch(search: string): string | undefined {
  const values = new URLSearchParams(search).getAll("campaign");
  // Ambiguous links must not arbitrarily choose one attribution.
  return values.length === 1 ? validCampaignCode(values[0]) : undefined;
}

/** A completed OTP must not leave a campaign attached to another sign-in on a shared browser. */
export function clearCampaignFromWelcomeUrl() {
  if (typeof window === "undefined" || window.location.pathname !== "/welcome") return;
  if (!new URLSearchParams(window.location.search).has("campaign")) return;
  try {
    // /welcome has no other query-dependent state. Do this before /me, which can fail independently.
    window.history.replaceState(window.history.state, "", "/welcome");
  } catch {
    // Optional attribution must never turn a successful authentication into an error.
  }
}
