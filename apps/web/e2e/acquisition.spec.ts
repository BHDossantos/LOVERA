import { expect, test, type Page } from "@playwright/test";

/** Exercise the real welcome/auth flow while inspecting its wire payload, without a seeded API. */
async function mockAuth(page: Page, opts: { rejectFirstCode?: boolean; profileUnavailable?: boolean } = {}) {
  const starts: Record<string, unknown>[] = [];
  const verifies: Record<string, unknown>[] = [];
  await page.route("**/api/auth/start", async (route) => {
    starts.push(route.request().postDataJSON());
    await route.fulfill({ json: { challenge_id: "campaign-otp", dev_code: "123456" } });
  });
  await page.route("**/api/auth/verify", async (route) => {
    verifies.push(route.request().postDataJSON());
    if (opts.rejectFirstCode && verifies.length === 1) {
      await route.fulfill({ status: 400, json: { error: { code: "INVALID_CODE", message: "Please try the code again." } } });
      return;
    }
    await route.fulfill({ json: { access_token: "test-access", refresh_token: "test-refresh" } });
  });
  await page.route("**/api/me", async (route) => {
    if (opts.profileUnavailable) {
      await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Please try again." } } });
      return;
    }
    await route.fulfill({ json: { id: "new-member", status: "pending_consent", onboarding_step: "account", roles: ["member"] } });
  });
  return { starts, verifies };
}

async function requestCode(page: Page) {
  await page.getByLabel("Email").fill("campaign-member@example.test");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
}

const ordinaryVerify = {
  challenge_id: "campaign-otp",
  code: "123456",
  device_id: expect.any(String),
};

test("a campaign link survives the home redirect, reload and OTP retry without browser attribution storage", async ({ page }) => {
  // Campaign attribution must also work where sessionStorage is denied.
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get: () => { throw new DOMException("Storage denied", "SecurityError"); } });
  });
  const { starts, verifies } = await mockAuth(page, { rejectFirstCode: true });
  await page.goto("/?campaign=rome-instagram&utm_campaign=private-text&referrer=https%3A%2F%2Fexample.test%2Fprivate");
  await expect(page).toHaveURL(/\/welcome\?campaign=rome-instagram$/);
  await page.reload();
  await requestCode(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Please try the code again.")).toBeVisible();
  await expect(page).toHaveURL(/\/welcome\?campaign=rome-instagram$/);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/account$/);
  expect(starts).toEqual([{ email: "campaign-member@example.test" }]);
  expect(verifies).toEqual([
    { ...ordinaryVerify, campaign_code: "rome-instagram" },
    { ...ordinaryVerify, campaign_code: "rome-instagram" },
  ]);
});

for (const [name, path] of [
  ["direct sign-in", "/welcome"],
  ["empty campaign", "/welcome?campaign="],
  ["overlong campaign", `/welcome?campaign=${"a".repeat(65)}`],
  ["free-text campaign", "/welcome?campaign=someone%40example.test"],
  ["malformed encoding", "/welcome?campaign=%E0%A4%A"],
  ["duplicate campaign", "/welcome?campaign=rome-instagram&campaign=rome-partners"],
  ["invalid home campaign", "/?campaign=%2Fprivate%3Fmember%3D123&utm_source=untrusted"],
]) {
  test(`${name} signs in without an attribution field`, async ({ page }) => {
    const { verifies } = await mockAuth(page);
    await page.goto(path);
    await requestCode(page);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding\/account$/);
    expect(verifies).toEqual([ordinaryVerify]);
  });
}

test("successful OTP clears the campaign even when loading the member subsequently fails", async ({ page }) => {
  const { verifies } = await mockAuth(page, { profileUnavailable: true });
  await page.goto("/welcome?campaign=rome-partners");
  await requestCode(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  expect(verifies).toEqual([{ ...ordinaryVerify, campaign_code: "rome-partners" }]);
});
