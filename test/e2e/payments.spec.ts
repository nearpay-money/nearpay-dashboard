import { expect, signIn, test } from "./harness";

test.describe("payments and agent payments", () => {
  test("list with filter, detail with attempts timeline, evidence explorer links and statement", async ({
    page,
    api,
  }) => {
    await signIn(page, api, "/payments");
    const table = page.getByTestId("payments-table");
    await expect(table).toContainText("$2.00");
    await expect(table).toContainText("$15.00");
    await page.getByLabel("Status").selectOption("succeeded");
    await expect(table).not.toContainText("$15.00");
    expect(api.callsTo("listPaymentIntents").at(-1)?.query).toMatchObject({ status: "succeeded", limit: "20" });
    await table.getByRole("link", { name: /Flat white/ }).click();
    await expect(page.getByRole("heading", { name: /^Payment pi_/ })).toBeVisible();
    await expect(page.getByText("$2.00").first()).toBeVisible();
    const attempts = page.getByTestId("attempts");
    await expect(attempts).toContainText("2.000017 USDC");
    await expect(attempts).toContainText("deposit timeout");
    await expect(attempts).toContainText("Tier A");
    const link = attempts.getByTestId("evidence-link");
    await expect(link).toHaveAttribute("href", "https://nearblocks.io/txns/8xQ3mTn2LkPq7Rv9sW4yZb6cDfGhJk");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(
      page
        .getByText("YZMN-R81Z-BR")
        .or(page.locator("code").filter({ hasText: /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/ })),
    ).toBeVisible();
    await expect(page.getByTestId("statement")).toContainText("2.000017 USDC (NEAR)");
    expect(api.callsTo("getCheckoutSession")).toHaveLength(1);
  });

  test("agent payments list, filter and detail", async ({ page, api }) => {
    await signIn(page, api, "/agent-payments");
    const table = page.getByTestId("agent-payments-table");
    await expect(table).toContainText("0.01 USDC");
    await expect(table).toContainText("Confirming");
    await page.getByLabel("Kind").selectOption("x402");
    await expect(table).not.toContainText("Confirming");
    await table.getByRole("link", { name: "0.01 USDC" }).click();
    await expect(page.getByText("https://acme.example/premium")).toBeVisible();
    await expect(page.getByRole("link", { name: /5gHq2ZtX/ })).toHaveAttribute(
      "href",
      "https://nearblocks.io/txns/5gHq2ZtXy8Wv3Rk",
    );
  });

  test("mode switch refetches in live mode", async ({ page, api }) => {
    await signIn(page, api, "/payments");
    await page.getByRole("switch", { name: "Live mode" }).click();
    await expect(page.getByRole("heading", { name: "No live payments yet" })).toBeVisible();
    expect(api.callsTo("listPaymentIntents").at(-1)?.headers["nearpay-mode"]).toBe("live");
  });
});

test.describe("settings", () => {
  test("saves settings; money settings need a step-up", async ({ page, api }) => {
    await signIn(page, api, "/settings/account");
    await page.getByLabel("Display name").fill("Acme Roasters");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(api.callsTo("updateAccount")[0]?.body).toEqual({ display_name: "Acme Roasters" });
    await expect(page.getByTestId("account-name")).toHaveText("Acme Roasters");

    await page.getByLabel(/Accept late payments/).check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    const calls = api.callsTo("updateAccount");
    expect(calls.at(-1)?.body).toEqual({ settings: { late_payments: true } });
    expect(calls.at(-1)?.headers["idempotency-key"]).toBe(calls.at(-2)?.headers["idempotency-key"]);
  });

  test("canceling the step-up shows a message and changes nothing", async ({ page, api }) => {
    await signIn(page, api, "/settings/account");
    await page.getByLabel("Underpayment tolerance (bps, 0–100)").fill("50");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alert")).toContainText("Confirmation canceled.");
    expect(api.account.settings.underpay_tolerance_bps).toBe(0);
  });
});
