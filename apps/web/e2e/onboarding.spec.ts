import { expect, test, type Page } from "@playwright/test";

/** Drives O01–O08 through the real browser against the running API (sandbox vendors). */
export async function signIn(page: Page, email: string) {
  await page.goto("/welcome");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
}

export async function completeOnboarding(page: Page, opts: { name: string; gender: string; seeking: string; zone: string; birth?: string }) {
  await expect(page).toHaveURL(/onboarding\/account/);
  await page.getByLabel("Date of birth").fill(opts.birth ?? "1991-04-12");
  for (const label of [/Terms of Service/, /Privacy Notice/, /Community Agreement/]) {
    await page.getByRole("switch", { name: label }).click();
  }
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/onboarding\/verification$/);
  await page.getByRole("button", { name: /Begin identity/ }).click();
  await expect(page).toHaveURL(/verification\/vendor/);
  await page.getByRole("button", { name: "Finish capture" }).click();
  await expect(page).toHaveURL(/onboarding\/intent/, { timeout: 20_000 });
  await page.getByLabel("I am a").selectOption(opts.gender);
  await page.getByRole("button", { name: opts.seeking, exact: true }).click();
  await page.getByLabel("Zone").selectOption(opts.zone);
  await page.getByRole("button", { name: "Commit to this lane" }).click();
  await expect(page).toHaveURL(/blueprint\/interview/);
  // Interview: answer until the review button appears
  for (let i = 0; i < 30; i++) {
    if (page.url().includes("/blueprint/review")) break;
    const review = page.getByRole("button", { name: /review my Blueprint/ });
    if (await review.isVisible().catch(() => false)) {
      await review.click();
      break;
    }
    const heading = page.getByRole("heading", { level: 1 });
    const before = await heading.textContent();
    const skip = page.getByRole("button", { name: "Skip this question" });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    } else {
      const radios = page.getByRole("radio");
      if ((await radios.count()) > 0) await radios.first().click();
      const partnerChips = page.locator("button[aria-pressed]");
      if ((await partnerChips.count()) > 0) await partnerChips.first().click();
      const submit = page.getByRole("button", { name: /Save and continue|That's me/ });
      await expect(submit).toBeEnabled();
      await submit.click();
    }
    // Wait for the next question to be committed (or the review page) before interacting again.
    await expect
      .poll(async () => (page.url().includes("/blueprint/review") ? "review" : await heading.textContent()), { timeout: 15_000 })
      .not.toBe(before);
  }
  await expect(page).toHaveURL(/blueprint\/review/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /Here's what we understood/ })).toBeVisible();
  await page.getByRole("button", { name: "Confirm my Blueprint" }).click();
  await expect(page).toHaveURL(/onboarding\/profile/, { timeout: 20_000 });
  await page.getByLabel("Display name").fill(opts.name);
  await page.getByLabel("About you").fill("Slow mornings, long lunches, honest conversations about the future and a weakness for good bread.");
  await page.getByRole("button", { name: "English" }).click();
  await page.locator('textarea[aria-label="Prompt answer"]').first().fill("Something outdoors with good coffee.");
  await page.locator('textarea[aria-label="Prompt answer"]').nth(1).fill("Cooking with a podcast on.");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  // By its label, not by its `accept` list: the list is now enumerated to match what the server
  // validates (app/core/datauri.py), and a selector that pinned the old wildcard turned a widened
  // allow-list into a 90-second timeout here.
  await page.getByLabel("Add a photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Live")).toBeVisible();
  // The voice note closes the one link in the upload chain no static check can see. The picker's
  // `accept` list, the kind its `upload(file, kind)` call sends, and the branch of `complete_media`
  // that kind selects are all compared by tools/check_upload_types.py — but not the request payload
  // in between, which could hard-code or invert `type` with every one of those still agreeing. Then
  // the server would validate this MP3 against the image allow-list and refuse it, and the photo
  // above against the audio list. Uploading one of each is what proves the kind survives the trip.
  const mp3 = Buffer.from("SUQzAwAAAAAAFlRTU0UAAAAMAAADTGF2ZjYwLjMuMTAA", "base64");
  await page.getByLabel("Add a voice note").setInputFiles({ name: "me.mp3", mimeType: "audio/mpeg", buffer: mp3 });
  await expect(page.getByText("Voice note added")).toBeVisible();
  await page.getByRole("button", { name: /Save my profile|Saved/ }).click();
  await expect(page).toHaveURL(/onboarding\/availability/, { timeout: 20_000 });
  await page.getByRole("button", { name: "Declare my availability" }).click();
  await expect(page).toHaveURL(/today/, { timeout: 20_000 });
}

test("a new member can verify, build a Blueprint, and reach Today", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await signIn(page, email);
  await completeOnboarding(page, { name: "Elena", gender: "woman", seeking: "Man", zone: "rome:prati" });
});
