import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use a preinstalled Chromium when present (CI installs its own via `playwright install`).
const preinstalled = process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const launchOptions = existsSync(preinstalled) ? { executablePath: preinstalled } : {};

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  /**
   * In CI, add the `github` reporter, which emits each failure as a `::error::` workflow annotation.
   *
   * The HTML report is unreachable from here — it is an artifact — and the job log is only readable
   * through a tool that returns its last few seconds, so a red run was diagnosed by guessing. An
   * annotation carries the file, the line and the message, is readable through the check-run API, and
   * survives log retention.
   */
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    launchOptions,
  },
  webServer: {
    command: "npm run build && npm run start -- -p 3000",
    url: "http://127.0.0.1:3000/welcome",
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
