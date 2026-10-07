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
   * Nothing here waits on real time: every helper in test/render.tsx is `act` plus a bounded
   * number of microtask rounds, and the API is a mock. So this cannot hide a hang in the app —
   * the only thing it tolerates is a worker that is not getting the CPU.
   *
   * Jest's 5-second default is sized for tests that await real I/O, and on a loaded runner it
   * turned the slowest test in the suite — 348ms locally, a first mount of the conversation
   * screen — into a timeout. That then fabricated a second failure: the navigation the
   * timed-out test had already triggered resolved inside the *next* test, which asserts that
   * nothing navigates. Two red tests, one of them an illusion, from a slow sixth of a second.
   */
  testTimeout: 30_000,
};
