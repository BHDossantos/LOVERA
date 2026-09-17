import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { introductionBetween, onboardApi, runBatchApi, signInBrowser, sql, subscribeApi } from "./helpers";

/**
 * The critical member journey through the real UI: introduction → private reciprocity → mutual chat →
 * AI draft (review then explicit send) → date planning → confirmation → check-in → private feedback →
 * mutual second date. Two members are prepared through the API; the concierge publishes a batch.
 */
test.describe.serial("member journey", () => {
  const stamp = Date.now();
  const emailA = `journey-a-${stamp}@example.test`;
  const emailB = `journey-b-${stamp}@example.test`;
  let idB = "";
  let introId = "";
  let conversationId = "";
  let planId = "";
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  async function open(browser: Browser, email: string): Promise<[BrowserContext, Page]> {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await signInBrowser(page, email);
    return [ctx, page];
  }

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  test.beforeAll(async ({ request, browser }) => {
    // Members left over from earlier local runs would compete for the same pair; pause them.
    try {
      sql("update members set status='paused' where email like 'journey-%' and status='active'");
    } catch {
      /* CI database is fresh */
    }
    // Ostia is far from most of the seed cohort, so these two are each other's best candidate.
    const a = await onboardApi(request, { email: emailA, name: "Ana", gender: "woman", seeking: ["man"], zone: "rome:ostia" });
    const b = await onboardApi(request, { email: emailB, name: "Ben", gender: "man", seeking: ["woman"], zone: "rome:ostia", birth: "1989-02-02" });
    idB = b.id;
    await subscribeApi(request, a);
    await subscribeApi(request, b);
    await runBatchApi(request);
    const intro = await introductionBetween(request, a, idB);
    expect(intro, "expected an introduction between Ana and Ben").not.toBeNull();
    introId = intro!.id;
    // Each member signs in once and keeps their session for the whole journey (like a real member).
    [ctxA, pageA] = await open(browser, emailA);
    [ctxB, pageB] = await open(browser, emailB);
  });

  test("Ana opens the introduction, reads the evidence, and says yes privately", async () => {
    const page = pageA;
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

  test("Ben sees no trace of Ana's decision, says yes, and chat opens exactly once", async () => {
    const page = pageB;
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
    // Exactly one bubble once the pending state clears: the realtime echo must not duplicate the message.
    await expect(page.getByText("Hi Ana! The matchmaker says our Saturdays look alike.")).toHaveCount(1);
  });

  test("Ana uses the AI Wingman: the draft is reviewed and sent only by her explicit action", async () => {
    const page = pageA;
    await page.goto(`/messages/${conversationId}/assistant`);
    await page.getByRole("button", { name: /Draft a message for me to edit/ }).click();
    const draft = page.getByRole("textbox").first();
    await expect(draft).not.toHaveValue("", { timeout: 20_000 });
    await expect(page.getByText(/nothing is sent|review/i).first()).toBeVisible();
    await draft.fill((await draft.inputValue()) + " Coffee Saturday?");
    await page.getByRole("button", { name: "Send this message" }).click();
    await expect(page).toHaveURL(new RegExp(`/messages/${conversationId}$`), { timeout: 20_000 });
    await expect(page.getByText(/Coffee Saturday\?/)).toHaveCount(1);
  });

  test("Ana proposes a public venue in an overlapping window; Ben confirms", async () => {
    const page = pageA;
    await page.goto(`/dates/new?conversation=${conversationId}`);
    await page.getByRole("radiogroup", { name: "Overlapping windows" }).getByRole("radio").first().click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Choose .* and pick a venue/ }).click();
    await expect(page).toHaveURL(/\/dates\/new\/venues/, { timeout: 20_000 });
    await expect(page.locator("body")).not.toContainText(/"lat"|"lon"/);
    const venues = page.getByRole("radiogroup", { name: "Venue options" }).getByRole("radio");
    await expect(venues).toHaveCount(3);
    await venues.first().click();
    await page.getByRole("button", { name: /^Propose / }).click();
    await expect(page).toHaveURL(/\/dates\/[0-9a-f-]+$/, { timeout: 20_000 });
    planId = page.url().split("/dates/")[1];
    await expect(page.getByText(/proposed/i).first()).toBeVisible();
    await pageB.goto(`/dates/${planId}`);
    await pageB.getByRole("button", { name: /^Confirm / }).click();
    await expect(pageB.getByText(/confirmed/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("Ana sets up a scoped check-in", async () => {
    const page = pageA;
    await page.goto(`/dates/${planId}/safety`);
    await expect(page.getByText("112").first()).toBeVisible();
    await page.getByLabel("Their name").fill("Giulia");
    await page.getByLabel("How to reach them").fill("+39 333 000 0000");
    await page.getByRole("button", { name: "Enable my safety plan" }).click();
    await expect(page.getByRole("button", { name: /Safety plan saved|Update my safety plan/ })).toBeVisible({ timeout: 20_000 });
  });

  test("after the date, private feedback reveals a second date only when mutual", async () => {
    const page = pageA;
    // Move the confirmed date into the past (no test-only endpoint is exposed by the API).
    sql(`update date_plans set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = '${planId}'`);
    const answer = async (p: Page) => {
      await p.goto(`/dates/${planId}/feedback`);
      await p.getByRole("radio", { name: /We met/ }).click();
      await p.getByRole("radiogroup", { name: "Felt safe" }).getByRole("radio").first().click();
      await p.getByRole("radiogroup", { name: "Enjoyed" }).getByRole("radio").first().click();
      await p.getByRole("radiogroup", { name: "Second date" }).getByRole("radio", { name: /^yes$/i }).click();
      await p.getByRole("button", { name: "Save my private answers" }).click();
      await expect(p).toHaveURL(/mutual-second-date/, { timeout: 20_000 });
    };
    await answer(page);
    // Ben has not answered: Ana must not see a one-sided result.
    await expect(page.locator("body")).not.toContainText(/both want a second date/i);
    await answer(pageB);
    await expect(pageB.getByText(/both want a second date/i)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByText(/both want a second date/i)).toBeVisible({ timeout: 20_000 });
  });
});
