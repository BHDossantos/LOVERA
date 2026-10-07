/**
 * The mobile app had no tests at all. Typecheck and a Metro bundle prove it compiles;
 * they proved nothing about whether a screen survives the payload the API actually sends,
 * which is how the Safety tab came to crash on `cases.map` and dial `tel:[object Object]`.
 *
 * These tests render screens against payloads copied from the API's own response, so a
 * client that invents a field fails here rather than on a member's phone.
 */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  testMatch: ["<rootDir>/test/**/*.test.tsx", "<rootDir>/test/**/*.test.ts"],
  collectCoverageFrom: ["app/**/*.tsx", "src/**/*.{ts,tsx}"],
};
