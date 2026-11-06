/**
 * Reject malformed native system links before Expo Router passes their query
 * strings to query-string's legacy URI decoder. This is a native-entry-point
 * mitigation, not a replacement for upgrading the vulnerable dependency.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.length > 8192) return "/";
  try {
    // Validate only. Returning the decoded form would change encoded separators,
    // duplicate query keys and provider callbacks; valid links remain verbatim.
    decodeURIComponent(path);
    return path;
  } catch {
    return "/";
  }
}
