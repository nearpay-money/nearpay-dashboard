/** Design v2 shell and Home behaviour: page/ID jumper, Needs attention → filtered list, Live/Test switch, 390 px layouts. */
import { intent } from "./fixtures";
import { expect, signIn, test } from "./harness";

test.describe("design v2", () => {
  test("top-bar search jumps to pages (⌘K) and opens pasted IDs", async ({ page, api }) => {
    await signIn(page, api);
    const search = page.getByRole("combobox", { name: "Search pages, or paste an ID" });
    await page.locator("body").press("Control+k");
    await expect(search).toBeFocused();
    await search.fill("payout");
    const results = page.getByRole("listbox", { name: "Search results" });
    await expect(results.getByRole("option").first()).toContainText("Payout wallets");
    await expect(search).toHaveAttribute("aria-expanded", "true");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/settlement(\?|$)/);
    await expect(page.getByRole("heading", { name: "Payout wallets", level: 1 })).toBeVisible();
    // arrow keys move the active option
    await search.fill("dev");
    await search.press("ArrowDown");
    await expect(results.getByRole("option", { selected: true })).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    // a pasted payment id opens the payment
    const id = api.intents.test[0]?.id ?? "";
    await search.fill(id);
    await expect(results.getByRole("option").first()).toContainText("Open payment");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: /^Payment pi_/ })).toBeVisible();
    // nothing matches: the listbox says what the field can do
    await search.fill("zzzz");
    await expect(page.getByText(/No page matches “zzzz”/)).toBeVisible();
  });

  test("Needs attention links to the filtered payments list; Live/Test switch keeps the mode in the URL", async ({
    page,
    api,
  }) => {
    api.intents.test.push(
      intent({ status: "requires_review", succeeded_at: null, review_reason: "short_settlement" as never }),
    );
    await signIn(page, api);
    const card = page.getByTestId("kpi-attention");
    await expect(card).toContainText("1 to review");
    await card.getByRole("link", { name: "1 to review" }).click();
    await expect(page).toHaveURL(/status=requires_review/);
    expect(api.callsTo("listPaymentIntents").at(-1)?.query).toMatchObject({ status: "requires_review" });
    const mode = page.getByRole("radiogroup", { name: "Mode" });
    await expect(mode.getByRole("radio", { name: "Test" })).toHaveAttribute("aria-checked", "true");
    await mode.getByRole("radio", { name: "Live" }).click();
    await expect(page).toHaveURL(/mode=live/);
    await expect(mode.getByRole("radio", { name: "Live" })).toHaveAttribute("aria-checked", "true");
  });

  test("390 px: Solana payout wallet attest page never scrolls sideways", async ({ page, api }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, api, "/settlement/new?mode=live");
    await page.getByLabel("Wallet name").fill("Solana treasury");
    await page.getByLabel("Currency").selectOption("SOL");
    await page.getByRole("radio", { name: /Address on/ }).check();
    await page.getByLabel("Wallet address").fill("EyjEeiTxb4rvkoN3ZA2zTimuc6VyF8V1QuH9TT66Gkn6");
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Connect wallet & verify" }).click();
    await expect(page.getByTestId("solana-signer")).toBeVisible();
    await expect(page.getByText(/solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // Home at 390: mobile bar + drawer
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Payout wallets" }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
