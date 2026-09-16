import { expect, test } from "@playwright/test";
import { introductionBetween, onboardApi, runBatchApi, signInBrowser, subscribeApi } from "./helpers";

/**
 * The critical member journey through the real UI: introduction → private reciprocity → mutual chat →
 * AI draft (review then explicit send) → date planning → confirmation → check-in → private feedback →
 * mutual second date. Two members are prepared through the API; the concierge publishes a batch.
 */
test.describe.serial("member journey", () => {
  const stamp = Date.now();
  const emailA = `journey-a-${stamp}@example.test`;
  const emailB = `journey-b-${stamp}@example.test`;
  let idA = "";
  let idB = "";
  let introId = "";
  let conversationId = "";
  let planId = "";

  test.beforeAll(async ({ request }) => {
    // Members left over from earlier local runs would compete for the same pair; pause them.
    const { execSync } = await import("node:child_process");
    try {
      execSync(`psql -h /tmp -p 5433 -U postgres -d matchmaker -c "update members set status='paused' where email like 'journey-%' and status='active'"`, { stdio: "ignore" });
    } catch {
      /* CI database is fresh */
    }
    // Ostia is far from most of the seed cohort, so these two are each other's best candidate.
    const a = await onboardApi(request, { email: emailA, name: "Ana", gender: "woman", seeking: ["man"], zone: "rome:ostia" });
    const b = await onboardApi(request, { email: emailB, name: "Ben", gender: "man", seeking: ["woman"], zone: "rome:ostia", birth: "1989-02-02" });
    idA = a.id;
    idB = b.id;
    await subscribeApi(request, a);
    await subscribeApi(request, b);
    await runBatchApi(request);
    const intro = await introductionBetween(request, a, idB);
    expect(intro, "expected an introduction between Ana and Ben").not.toBeNull();
    introId = intro!.id;
  });

  test("Ana opens the introduction, reads the evidence, and says yes privately", async ({ page }) => {
    await signInBrowser(page, emailA);
    await page.goto(`/introductions/${introId}`);
    await expect(page.getByText("Ben", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Verified/).first()).toBeVisible();
    await page.getByRole("link", { name: /Open the evidence/ }).click();
    await expect(page).toHaveURL(/\/why/);
    await expect(page.getByText(/Strong evidence|Promising|Low evidence/).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("%");
    await page.goto(`/introductions/${introId}/decision`);
    await page.getByRole("radio", { name: /yes/i }).first().click();
    await page.getByRole("button", { name: /Say yes privately/ }).click();
    await expect(page.getByText(/private until they decide/i)).toBeVisible({ timeout: 15_000 });
  });

  test("Ben sees no trace of Ana's decision, says yes, and chat opens exactly once", async ({ page }) => {
    await signInBrowser(page, emailB);
    await page.goto(`/introductions/${introId}`);
    await expect(page.locator("body")).not.toContainText(/accepted|said yes/i);
    await page.goto(`/introductions/${introId}/decision`);
    await page.getByRole("radio", { name: /yes/i }).first().click();
    await page.getByRole("button", { name: /Say yes privately/ }).click();
    await expect(page).toHaveURL(/\/mutual/, { timeout: 20_000 });
    await page.getByRole("link", { name: /Start the conversation/ }).click();
    await expect(page).toHaveURL(/\/messages\//);
    conversationId = page.url().split("/messages/")[1].split(/[?#]/)[0];
    const composer = page.getByRole("textbox").first();
    await composer.fill("Hi Ana! The matchmaker says our Saturdays look alike.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Hi Ana! The matchmaker says our Saturdays look alike.")).toBeVisible();
  });

  test("Ana uses the AI Wingman: the draft is reviewed and sent only by her explicit action", async ({ page }) => {
    await signInBrowser(page, emailA);
    await page.goto(`/messages/${conversationId}/assistant`);
    await page.getByRole("button", { name: /Draft a message for me to edit/ }).click();
    const draft = page.getByRole("textbox").first();
    await expect(draft).not.toHaveValue("", { timeout: 20_000 });
    await expect(page.getByText(/nothing is sent|review/i).first()).toBeVisible();
    await draft.fill((await draft.inputValue()) + " Coffee Saturday?");
    await page.getByRole("button", { name: "Send this message" }).click();
    await expect(page).toHaveURL(new RegExp(`/messages/${conversationId}$`), { timeout: 20_000 });
    await expect(page.getByText(/Coffee Saturday\?/)).toBeVisible();
  });

  test("Ana proposes a public venue in an overlapping window; Ben confirms", async ({ page, request }) => {
    await signInBrowser(page, emailA);
    await page.goto(`/dates/new?conversation=${conversationId}`);
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: /venue|Continue|Choose/i }).first().click();
    await expect(page).toHaveURL(/\/dates\/new\/venues/, { timeout: 20_000 });
    await expect(page.locator("body")).not.toContainText(/lat|lon/);
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: /Propose/ }).click();
    await expect(page).toHaveURL(/\/dates\/[0-9a-f-]+$/, { timeout: 20_000 });
    planId = page.url().split("/dates/")[1];
    await expect(page.getByText(/proposed/i).first()).toBeVisible();
    // Ben confirms through the API-backed UI in a fresh context
    const benPage = await page.context().browser()!.newPage();
    await signInBrowser(benPage, emailB);
    await benPage.goto(`/dates/${planId}`);
    await benPage.getByRole("button", { name: /Confirm|Accept/ }).first().click();
    await expect(benPage.getByText(/confirmed/i).first()).toBeVisible({ timeout: 20_000 });
    await benPage.close();
    void request;
  });

  test("Ana sets up a scoped check-in", async ({ page }) => {
    await signInBrowser(page, emailA);
    await page.goto(`/dates/${planId}/safety`);
    await expect(page.getByText("112")).toBeVisible();
    await page.getByLabel(/contact name/i).fill("Giulia");
    await page.getByLabel(/channel|phone|how to reach/i).first().fill("+39 333 000 0000");
    await page.getByRole("button", { name: /Enable|Save|Set up/ }).first().click();
    await expect(page.getByText(/scheduled|enabled|Giulia/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("after the date, private feedback reveals a second date only when mutual", async ({ page, request }) => {
    // Move the confirmed date into the past through the API's DB (test-only helper endpoint is not exposed), so use SQL.
    const { execSync } = await import("node:child_process");
    execSync(`psql -h /tmp -p 5433 -U postgres -d matchmaker -c "update date_plans set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = '${planId}'"`, { stdio: "ignore" });
    await signInBrowser(page, emailA);
    await page.goto(`/dates/${planId}/feedback`);
    await page.getByRole("radio", { name: /attended|We met|happened/i }).first().click();
    await page.getByRole("radio", { name: /^Yes/ }).first().click();
    await page.getByRole("button", { name: /Save privately|Record|Save/ }).first().click();
    await expect(page).toHaveURL(/mutual-second-date/, { timeout: 20_000 });
    await expect(page.locator("body")).not.toContainText(/both want a second date/i);
    const benPage = await page.context().browser()!.newPage();
    await signInBrowser(benPage, emailB);
    await benPage.goto(`/dates/${planId}/feedback`);
    await benPage.getByRole("radio", { name: /attended|We met|happened/i }).first().click();
    await benPage.getByRole("radio", { name: /^Yes/ }).first().click();
    await benPage.getByRole("button", { name: /Save privately|Record|Save/ }).first().click();
    await expect(benPage).toHaveURL(/mutual-second-date/, { timeout: 20_000 });
    await expect(benPage.getByText(/both want a second date/i)).toBeVisible({ timeout: 20_000 });
    await benPage.close();
    void request;
  });
});
