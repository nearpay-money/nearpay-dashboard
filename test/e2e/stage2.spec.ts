import { readFileSync } from "node:fs";
import { apiKey, destination, endpoint, intent, NOW } from "./fixtures";
import { expect, signIn, test } from "./harness";

test.describe("dashboard core (step 2.3)", () => {
  test("payments: ADR-0018 filters in the URL, amount ranges, metadata, CSV export", async ({ page, api }) => {
    await signIn(page, api, "/payments");
    await page.getByLabel("Currency").selectOption("usd");
    await expect(page).toHaveURL(/currency=usd/);
    await page.getByRole("button", { name: "More filters" }).click();
    const more = page.getByTestId("more-filters");
    await more.getByLabel("From", { exact: true }).fill("1.50");
    await more.getByLabel("To", { exact: true }).fill("20");
    await more.getByLabel("Key").fill("order_id");
    await more.getByLabel("Value").fill("42");
    await more.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("button", { name: "More filters · 3" })).toBeVisible();
    expect(api.callsTo("listPaymentIntents").at(-1)?.query).toMatchObject({
      currency: "usd",
      "amount[gte]": "150",
      "amount[lte]": "2000",
      "metadata[order_id]": "42",
      limit: "20",
    });
    // reload keeps the filters (they live in the URL)
    await page.reload();
    await expect(page.getByLabel("Currency")).toHaveValue("usd");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^nearpay-payments-test-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await file.path()) as string, "utf8");
    expect(csv).toContain("id,created_utc,status");
    expect(csv).toContain(",2.00,usd,");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/payments$/);
  });

  test("payment detail: gross, fee and settlement stats, activity, settlement card", async ({ page, api }) => {
    const pi = api.intents.test[0];
    await signIn(page, api, `/payments/${pi?.id}`);
    await expect(page.getByRole("heading", { name: /^Payment pi_/ })).toBeVisible();
    const stats = page.locator(".dash-stats");
    await expect(stats).toContainText("Purchase");
    await expect(stats).toContainText("$2.00");
    await expect(stats).toContainText("0.006 USDC");
    await expect(stats).toContainText("2.000017 USDC");
    await expect(page.getByRole("list", { name: "Payment activity" })).toContainText("Payment complete");
    await expect(page.getByRole("link", { name: "View transaction" })).toHaveAttribute(
      "href",
      "https://nearblocks.io/txns/8xQ3mTn2LkPq7Rv9sW4yZb6cDfGhJk",
    );
    await expect(page.getByText("NearPay does not hold your balance.")).toBeVisible();
    // the refund flow belongs to the refunds area
    await expect(page.getByRole("link", { name: "Refund payment" }).first()).toHaveAttribute(
      "href",
      `/payments/${pi?.id}/refund`,
    );
  });

  test("first-payment empty state", async ({ page, api }) => {
    api.intents.test = [];
    await signIn(page, api, "/payments");
    await expect(page.getByRole("heading", { name: "Your first payment starts here." })).toBeVisible();
    await expect(page.getByText("Test mode · no real funds move")).toBeVisible();
  });

  test("two-approver destination: progress, approve (step-up), approver conflict explained", async ({ page, api }) => {
    const d = destination({
      livemode: true,
      label: "Treasury",
      status: "pending_approval",
      verification: "signature",
      is_default: false,
      active_at: null,
      approval: { required: 2, approved_by: [], rejected_by: null },
    });
    api.destinations.live.push(d);
    await signIn(page, api, "/settlement?mode=live");
    await expect(page.getByTestId("approval")).toHaveText("0 of 2 approvals");
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByTestId("approval")).toHaveText("1 of 2 approvals");
    const calls = api.callsTo("approveSettlementDestination");
    expect(calls.at(-1)?.body).toEqual({ decision: "approve" });
    expect(calls[0]?.headers["idempotency-key"]).toBe(calls[1]?.headers["idempotency-key"]);
    // the same user cannot give the second approval: the button says why
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  test("cool-off copy follows active_at: countdown when waiting, 'now' with no cool-off", async ({ page, api }) => {
    const now = Math.floor(Date.now() / 1000);
    const live = {
      livemode: true,
      verification: "signature" as const,
      is_default: false,
      status: "cooling_off" as const,
    };
    api.destinations.live.push(
      destination({ ...live, label: "Instant", address: "instant.near", active_at: now }), // NP_COOLOFF_SECONDS=0
      destination({ ...live, label: "Later", address: "later.near", active_at: now + 3 * 3600 + 60 }),
    );
    await signIn(page, api, "/settlement?mode=live");
    const status = page.getByTestId("cooloff");
    await expect(status.nth(0)).toHaveText("Activating now");
    await expect(status.nth(1)).toHaveText("Activates in about 3 hours");
    await expect(page.getByText(/Later activates .* · about 3 hours remaining/)).toBeVisible();
    await expect(page.getByText(/Instant activates/)).toHaveCount(0);
    await expect(page.getByText(/24.hour/)).toHaveCount(0);
  });

  test("restricted key with the scope matrix; edit scopes", async ({ page, api }) => {
    api.stepUpUntil = NOW + 3600;
    await signIn(page, api, "/developers");
    await page.getByRole("button", { name: "Create key" }).click();
    await page.getByRole("radio", { name: /Restricted key/ }).check();
    await page.getByLabel("Name", { exact: true }).fill("Checkout server");
    await page.getByRole("radio", { name: "Payments: write" }).check();
    await page.getByRole("radio", { name: "Refunds: read" }).check();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByTestId("secret-value")).toBeVisible();
    expect(api.callsTo("createApiKey").at(-1)?.body).toEqual({
      type: "restricted",
      name: "Checkout server",
      livemode: false,
      scopes: ["payment_intents.write", "refunds.read"],
    });
    await expect(page.getByTestId("keys-table")).toContainText("Restricted · Payments: write · Refunds: read");
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("radio", { name: "Refunds: none" }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("keys-table")).toContainText("Restricted · Payments: write");
    expect(api.callsTo("updateApiKey").at(-1)?.body).toMatchObject({ scopes: ["payment_intents.write"] });
  });

  test("webhook secret rotation with overlap, resend a delivery", async ({ page, api }) => {
    const ep = endpoint({ url: "https://acme.example/rot" });
    api.endpoints.test.push(ep);
    api.keys.test.push(apiKey());
    api.stepUpUntil = NOW + 3600;
    await signIn(page, api, `/developers/webhooks/${ep.id}`);
    await page.getByRole("button", { name: "Rotate secret" }).click();
    await page.getByLabel("The previous secret stops signing").selectOption("3600");
    await page.getByRole("dialog").getByRole("button", { name: "Rotate secret" }).click();
    await expect(page.getByTestId("secret-value")).toHaveText(/^whsec_R0tAtEd1/);
    expect(api.callsTo("rotateWebhookEndpointSecret")[0]?.body).toEqual({ expire_previous_in_seconds: 3600 });
    await expect(page.getByText(/Still signs until/)).toBeVisible();
    // a ping creates an event; resend it to this endpoint from the delivery log
    await page.getByRole("button", { name: "Send test event" }).click();
    const evt = api.events.test[0];
    api.deliveries.set(ep.id, [
      (await import("./fixtures")).delivery(ep.id, { event: evt?.id as never, event_type: "ping", status: "failed" }),
    ]);
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("button", { name: "Resend" }).click();
    await expect(page.getByText("Event queued again")).toBeVisible();
    expect(api.callsTo("resendEvent")[0]?.body).toEqual({ endpoint: ep.id });
  });

  test("account switcher lists memberships and switches the session account", async ({ page, api }) => {
    api.memberships = [{ id: "acct_01jbz9k3m4n5p6q7r8s9t0zzzz", display_name: "Bean There", role: "admin" }];
    await signIn(page, api);
    await page.getByRole("button", { name: /Switch workspace/ }).click();
    await page.getByRole("button", { name: /Bean There/ }).click();
    await expect(page.getByTestId("account-name")).toHaveText("Bean There");
    expect(api.callsTo("switchSessionAccount")[0]?.body).toEqual({ account: "acct_01jbz9k3m4n5p6q7r8s9t0zzzz" });
    expect(api.callsTo("switchSessionAccount")[0]?.headers["x-csrf-token"]).toBe(api.csrf);
  });

  test("agent payments: stats, resources from real payments, add paid resource code", async ({ page, api }) => {
    api.destinations.test.push(destination({ label: "Treasury" }));
    await signIn(page, api, "/agent-payments");
    await expect(page.getByTestId("resources-table")).toContainText("acme.example/premium");
    await page.getByRole("link", { name: "Add paid resource" }).click();
    await page.getByLabel("Resource name").fill("Market data lookup");
    await page.getByLabel("Resource address").fill("https://api.acme.example/market-data");
    await page.getByLabel(/Price per request/).fill("0.01");
    await page.getByRole("button", { name: "Create test resource" }).click();
    const code = page.getByTestId("resource-snippet");
    await expect(code).toContainText('amount: "10000"');
    await expect(code).toContainText('pay_to: "acme.near"');
  });

  test("settings index links to the settings pages that exist", async ({ page, api }) => {
    await signIn(page, api, "/settings");
    await expect(page.getByTestId("settings-card-account")).toBeVisible();
    await expect(page.getByTestId("settings-card-notifications")).toBeVisible();
    await page.getByTestId("settings-card-notifications").click();
    await page.getByLabel("Email receipts to customers").click();
    await expect(page.getByText("Customer receipts off")).toBeVisible();
    expect(api.callsTo("updateAccount").at(-1)?.body).toEqual({ settings: { email_receipts: false } });
  });

  for (const width of [390, 1440]) {
    test(`stat rows never overflow at ${width}px; drawer navigation below 960px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      api.intents.test.push(intent({ amount: 123456789012, description: "A very large invoice payment" }));
      api.destinations.test.push(destination({ label: "Treasury" }), destination({ label: "Ops", is_default: false }));
      api.keys.test.push(apiKey({ name: "Server" }));
      await signIn(page, api);
      await expect(page.getByTestId("volume-chart")).toBeVisible();
      for (const path of [
        "/",
        `/payments/${api.intents.test[0]?.id}`,
        "/agent-payments",
        "/developers/start",
        "/settlement",
        "/developers",
      ]) {
        await page.goto(path);
        await expect(page.locator("h1")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll(".dash-stats .np-stat")].some((el) => el.scrollWidth > el.clientWidth + 1),
        );
        expect(overflow, `stat overflow on ${path}`).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      }
      if (width < 960) {
        await page.getByRole("button", { name: "Open menu" }).click();
        await page.getByRole("link", { name: "Settlement" }).click();
        await expect(page.getByRole("heading", { name: "Settlement" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
      }
    });
  }
});
