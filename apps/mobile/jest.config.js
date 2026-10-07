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
  /**
   * In CI, also report through the GitHub Actions reporter, which emits each failure as a
   * `::error::` workflow annotation.
   *
   * Written after a mobile failure that could not be read at all: the job log is only reachable
   * through a tool that returns its last few seconds, and the check run's annotations carried
   * nothing but "Process completed with exit code 1". Two tests had failed and there was no way to
   * learn which assertion, so the diagnosis came down to guessing from the warnings that happened
   * to fall inside the readable window. Annotations are reachable, and they survive log retention.
   */
  reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
};
