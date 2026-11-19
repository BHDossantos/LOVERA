import { expect, test, type Page } from "@playwright/test";

const campaigns = [
  { code: "rome-instagram", source: "instagram", label: "Rome · Instagram" },
  { code: "rome-community", source: "community", label: "Rome · Community" },
  { code: "rome-partners", source: "partner", label: "Rome · Partners" },
];

function acquisitionReport(days = 30) {
  const windowEnd = new Date("2026-11-18T12:00:00Z");
  return {
    days,
    window_start: new Date(windowEnd.getTime() - days * 86_400_000).toISOString(),
    window_end: windowEnd.toISOString(),
    minimum_cohort_size: 5,
    campaigns,
    cohorts: [
      {
        campaign_code: "rome-instagram",
        source: "instagram",
        label: "Rome · Instagram",
        signups: days === 7 ? 15 : 42,
        verification_completed: days === 7 ? 10 : 30,
        blueprint_confirmed: days === 7 ? 5 : 24,
        profile_completed: days === 7 ? 5 : 18,
      },
      {
        campaign_code: "rome-community",
        source: "community",
        label: "Rome · Community",
        signups: null,
        verification_completed: null,
        blueprint_confirmed: null,
        profile_completed: null,
      },
    ],
  };
}

async function signedInStaff(page: Page, roles: string[] = ["admin"]) {
  await page.addInitScript(() => window.localStorage.setItem("mm.refresh", "admin-test-refresh"));
  await page.route("**/api/auth/refresh", async (route) => {
    await route.fulfill({ json: { access_token: "admin-test-access", refresh_token: "admin-test-refresh" } });
  });
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ json: { id: "staff-test-member", status: "active", onboarding_step: "done", roles } });
  });
}

async function reports(page: Page) {
  const requestedWindows: number[] = [];
  await page.route(/\/api\/admin\/acquisition(?:\?|$)/, async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get("days"));
    requestedWindows.push(days);
    await route.fulfill({ json: acquisitionReport(days) });
  });
  return requestedWindows;
}

test("admin sees exact milestone counts and withheld cohorts without horizontal page overflow", async ({ page }) => {
  await signedInStaff(page);
  const requestedWindows = await reports(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/acquisition");
  await expect(page.getByRole("heading", { name: "Acquisition insights", exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "New-member progress by acquisition source" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["Source", "Signups", "Verified", "Blueprint confirmed", "Profile milestone"]);
  const instagram = table.getByRole("row").filter({ hasText: "Rome · Instagram" });
  await expect(instagram.getByRole("rowheader")).toContainText("Rome · Instagram");
  await expect(instagram.getByRole("cell").nth(0)).toHaveText("42");
  await expect(instagram.getByRole("cell").nth(1)).toHaveText("30");
  await expect(instagram.getByRole("cell").nth(2)).toHaveText("24");
  await expect(instagram.getByRole("cell").nth(3)).toHaveText("18");
  const community = table.getByRole("row").filter({ hasText: "Rome · Community" });
  for (let cell = 0; cell < 4; cell++) await expect(community.getByRole("cell").nth(cell)).toHaveText("Withheld");
  await expect(community.getByText("0", { exact: true })).toHaveCount(0);
  expect(requestedWindows).toContain(30);
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
});

test("changing the signup window requests and renders that cohort", async ({ page }) => {
  await signedInStaff(page);
  const requestedWindows = await reports(page);
  await page.goto("/admin/acquisition");
  const windowSelect = page.getByLabel("Signup window", { exact: true });
  await expect(windowSelect).toHaveValue("30");
  await expect(windowSelect.getByRole("option")).toHaveText(["Last 7 days", "Last 30 days", "Last 90 days"]);
  await windowSelect.selectOption("7");
  const table = page.getByRole("table", { name: "New-member progress by acquisition source" });
  const instagram = table.getByRole("row").filter({ hasText: "Rome · Instagram" });
  await expect(instagram.getByRole("cell").nth(0)).toHaveText("15");
  await expect(instagram.getByRole("cell").nth(1)).toHaveText("10");
  expect(requestedWindows).toContain(7);
});

test("copying an approved campaign link uses the current origin", async ({ page }) => {
  await signedInStaff(page);
  await reports(page);
  await page.addInitScript(() => {
    const target = window as unknown as { copiedCampaignLinks: string[] };
    target.copiedCampaignLinks = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { target.copiedCampaignLinks.push(text); } },
    });
  });
  await page.goto("/admin/acquisition");
  await page.getByRole("button", { name: "Copy link for Rome · Instagram", exact: true }).click();
  await expect(page.getByText("Link copied for Rome · Instagram")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { copiedCampaignLinks: string[] }).copiedCampaignLinks);
  expect(copied).toEqual([`${new URL(page.url()).origin}/welcome?campaign=rome-instagram`]);
});

test("a failed report can be retried without silently showing zero totals", async ({ page }) => {
  await signedInStaff(page);
  let unavailable = true;
  await page.route(/\/api\/admin\/acquisition(?:\?|$)/, async (route) => {
    if (unavailable) {
      await route.fulfill({ status: 503, json: { error: { code: "ACQUISITION_UNAVAILABLE", message: "Acquisition totals are temporarily unavailable.", retryable: true } } });
    } else {
      await route.fulfill({ json: acquisitionReport() });
    }
  });
  await page.goto("/admin/acquisition");
  await expect(page.getByText("Acquisition totals are temporarily unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "New-member progress by acquisition source" })).toHaveCount(0);
  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("table", { name: "New-member progress by acquisition source" })).toBeVisible();
  await expect(page.getByText("Acquisition totals are temporarily unavailable.", { exact: true })).toHaveCount(0);
});

for (const role of ["member", "concierge"]) {
  test(`${role} cannot fetch the report or see its workspace navigation`, async ({ page }) => {
    await signedInStaff(page, [role]);
    const requestedWindows = await reports(page);
    await page.goto("/admin/acquisition");
    await expect(page.getByText("FORBIDDEN: this workspace is not part of your role", { exact: true })).toBeVisible();
    await expect(page.locator('nav[aria-label="Console workspaces"] a[href="/admin/acquisition"]')).toHaveCount(0);
    await expect(page.getByRole("table", { name: "New-member progress by acquisition source" })).toHaveCount(0);
    expect(requestedWindows).toEqual([]);
  });
}
