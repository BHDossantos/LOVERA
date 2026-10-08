/**
 * A date's time is the venue's, and the reader may not be standing in that zone.
 *
 * Both apps used to render a plan's `starts_at` without naming any zone, and they did not agree on
 * which zone it was: the web app used `plan.timezone`, this app used `new Date(...).toLocaleString()`,
 * which is the device's. For two members in the same market — which is the ordinary case — those
 * happen to agree, which is why nothing caught it. For a member reading from somewhere else they are
 * an hour or more apart, with nothing on screen to say which one they are looking at.
 */
import { formatPlanTime, planTimeLine } from "../src/lib/format";

// 19:00 on a Friday evening in Rome, well clear of a DST change.
const EVENING = "2026-10-09T17:00:00Z";
const ROME = "Europe/Rome";

// The viewer's zone is passed rather than set on the process: under jest `process.env.TZ` does not
// reach `Intl`, so every one of these assertions silently measured UTC until the helper took it as an
// argument. That is the whole reason `formatPlanTime` has a `viewer` parameter.

describe("formatPlanTime", () => {
  it("names the venue's zone, so a bare clock reading is never shown", () => {
    const { at } = formatPlanTime(EVENING, ROME, ROME);
    expect(at).toBe("Fri 9 Oct, 19:00 CEST");
  });

  it("says nothing extra when the reader is in the venue's zone", () => {
    expect(formatPlanTime(EVENING, ROME, ROME).alsoYours).toBeNull();
  });

  it("carries the reader's own clock when they are somewhere else", () => {
    const { at, alsoYours } = formatPlanTime(EVENING, ROME, "Europe/London");
    expect(at).toBe("Fri 9 Oct, 19:00 CEST");
    expect(alsoYours).toBe("Fri 9 Oct, 18:00 your time");
  });

  it("carries the date too when the two zones are not on the same day", () => {
    // 19:00 Friday in Rome is still Friday morning in Auckland's terms? No — it is Saturday there.
    const { alsoYours } = formatPlanTime(EVENING, ROME, "Pacific/Auckland");
    expect(alsoYours).toContain("Sat 10 Oct");
    expect(alsoYours).toContain("your time");
  });

  it("renders once and claims nothing when the plan has no zone yet", () => {
    const { at, alsoYours } = formatPlanTime(EVENING, null, "Europe/London");
    expect(at).toBe("Fri 9 Oct, 18:00");
    expect(at).not.toMatch(/BST|GMT|CEST/);
    expect(alsoYours).toBeNull();
  });

  it("is empty for a missing or unparseable time rather than showing Invalid Date", () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      expect(formatPlanTime(bad, ROME)).toEqual({ at: "", alsoYours: null });
    }
  });

  it("folds to one line where a layout cannot take two", () => {
    expect(planTimeLine(EVENING, ROME, ROME)).toBe("Fri 9 Oct, 19:00 CEST");
    expect(planTimeLine(EVENING, ROME, "Europe/London")).toBe("Fri 9 Oct, 19:00 CEST · Fri 9 Oct, 18:00 your time");
  });
});
