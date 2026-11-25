import { expect, test } from "@playwright/test";

test("a signed-out Play reviewer can find the web account deletion route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/legal/privacy");
  await page.getByRole("link", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/legal\/delete-account$/);
  await expect(page.getByRole("heading", { name: "Delete your Lovera account" })).toBeVisible();
  await expect(page.getByText("You → Your data → Delete my account")).toBeVisible();
  await expect(page.getByRole("link", { name: "Lovera Privacy Notice" })).toBeVisible();
  await page.getByRole("link", { name: "Sign in to Lovera" }).click();
  await expect(page).toHaveURL(/\/welcome$/);
});
