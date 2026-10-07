import { telUri } from "@/components/safety";

/**
 * The API writes its emergency fields for people, not for dialers: the date plan sends the
 * string "112 (EU)" and the safety centre an { number, note } object. Both were being
 * interpolated straight into a tel: URI.
 */
test("keeps digits from a human-readable string", () => {
  expect(telUri("112 (EU)")).toBe("tel:112");
});

test("reads the number out of the safety centre's object", () => {
  expect(telUri({ number: "112" })).toBe("tel:112");
});

test("never produces [object Object]", () => {
  // The exact shape that shipped: an object interpolated into a template literal.
  expect(telUri({ number: "112", note: "Italy" } as { number: string })).not.toContain("[object");
});

test("keeps an international prefix", () => {
  expect(telUri("+39 06 1234")).toBe("tel:+39061234");
});

test("falls back when there is nothing to dial", () => {
  expect(telUri(null)).toBe("tel:112");
  expect(telUri(undefined)).toBe("tel:112");
  expect(telUri("not a number at all")).toBe("tel:112");
});
