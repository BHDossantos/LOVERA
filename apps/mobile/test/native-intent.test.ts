import { redirectSystemPath } from "../app/+native-intent";

it.each([true, false])("preserves valid links verbatim (initial=%s)", (initial) => {
  for (const path of [
    "/messages/conversation-1",
    "lovera://onboarding/verification/vendor?ref=a%2Fb%3Fc%3Dd",
    "https://joinlovera.app/introductions/123?label=Jos%C3%A9&x=1&x=2",
    "lovera://messages/a?text=hello+world&literal=%25FF",
  ]) {
    expect(redirectSystemPath({ path, initial })).toBe(path);
  }
});

it.each([true, false])("rejects malformed native input before legacy decoding (initial=%s)", (initial) => {
  for (const value of ["%", "%zz", "%E0%A4", "%FF", "%C0%AF", "%ED%A0%80", "%F4%90%80%80"]) {
    expect(redirectSystemPath({ path: `lovera://messages/a?text=${value}`, initial })).toBe("/");
  }
  const distinctRuns = Array.from({ length: 900 }, (_, i) =>
    `%${Math.floor(i / 256).toString(16).padStart(2, "0")}%${(i % 256).toString(16).padStart(2, "0")}x`
  ).join("");
  expect(redirectSystemPath({ path: `lovera://messages/a?text=${distinctRuns}%zz`, initial })).toBe("/");
  expect(redirectSystemPath({ path: `lovera://messages/a?text=${"x".repeat(8192)}`, initial })).toBe("/");
});
