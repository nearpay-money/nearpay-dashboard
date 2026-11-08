import { delivery, endpoint, NOW } from "./fixtures";
import { expect, signIn, test } from "./harness";

test.describe("developers", () => {
  test("API keys: create (secret shown once), roll, revoke — with step-up", async ({ page, api }) => {
    await signIn(page, api, "/developers");
    await page.getByRole("button", { name: "Create key" }).click();
    await page.getByLabel("Name").fill("Backend");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByTestId("secret-value")).toHaveText(/^sk_test_/);
    const create = api.callsTo("createApiKey").at(-1);
    expect(create?.body).toEqual({ type: "secret", name: "Backend", livemode: false });
    await expect(page.getByTestId("keys-table")).toContainText("Backend");

    await page.getByRole("button", { name: "Roll" }).click();
    await page.getByLabel("The old key stops working").selectOption("86400");
    await page.getByRole("button", { name: "Roll key" }).click();
    await expect(page.getByTestId("secret-value")).toContainText("Z9y8");
    expect(api.callsTo("rollApiKey")[0]?.body).toEqual({ expire_old_in_seconds: 86400 });

    const before = api.keys.test.length;
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await page.getByRole("button", { name: "Revoke key" }).click();
    await expect(page.getByTestId("keys-table").locator("tbody tr")).toHaveCount(before - 1);
    expect(api.callsTo("revokeApiKey")[0]?.headers["x-csrf-token"]).toBe(api.csrf);
  });

  test("live keys are disabled until live mode is enabled", async ({ page, api }) => {
    await signIn(page, api, "/developers?mode=live");
    await expect(page.getByRole("button", { name: "Create key" })).toBeDisabled();
  });

  test("a viewer cannot manage keys", async ({ page, api }) => {
    api.role = "viewer";
    await signIn(page, api, "/settlement");
    await page.getByRole("link", { name: "Add destination" }).click();
    await expect(page.getByRole("button", { name: "Add destination" })).toBeDisabled();
  });

  test("webhook endpoints: create (secret once), test ping, disable, delete; events", async ({ page, api }) => {
    await signIn(page, api, "/developers/webhooks");
    await page.getByRole("button", { name: "Add endpoint" }).click();
    await page.getByLabel("Endpoint URL").fill("https://acme.example/hooks");
    await page.getByLabel("agent_payment.settled").check();
    await page.getByRole("dialog").getByRole("button", { name: "Add endpoint" }).click();
    await expect(page.getByTestId("secret-value")).toHaveText(/^whsec_/);
    expect(api.callsTo("createWebhookEndpoint")[0]?.body).toEqual({
      url: "https://acme.example/hooks",
      enabled_events: ["payment_intent.succeeded", "agent_payment.settled"],
    });
    await page.getByRole("link", { name: "https://acme.example/hooks" }).click();
    await page.getByRole("button", { name: "Send test event" }).click();
    await expect(page.getByText("queued for delivery")).toBeVisible();
    await page.getByRole("button", { name: "Disable" }).click();
    await expect(page.getByRole("button", { name: "Enable" })).toBeVisible();
    expect(api.callsTo("updateWebhookEndpoint")[0]?.body).toEqual({ disabled: true });
    await expect(page.getByText("No deliveries in the last 30 days.")).toBeVisible();
    await page.getByRole("link", { name: "View event" }).click();
    await expect(page.getByTestId("event-json")).toContainText('"type": "ping"');
    await page.getByRole("link", { name: "Events" }).click();
    await expect(page.getByTestId("events-table")).toContainText("payment_intent.succeeded");
    await page.getByLabel("Type").selectOption("ping");
    await expect(page.getByTestId("events-table")).not.toContainText("payment_intent.succeeded");
    expect(api.callsTo("listEvents").at(-1)?.query).toMatchObject({ type: "ping" });
    await page.getByRole("link", { name: "Notifications" }).click();
    await page.getByRole("link", { name: "https://acme.example/hooks" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete endpoint" }).click();
    await expect(page).toHaveURL(/\/developers\/webhooks$/);
    await expect(page.getByText("No test endpoints yet.")).toBeVisible();
  });

  test("webhook delivery log: status, attempts, last response, pagination (spec 0.1.5)", async ({ page, api }) => {
    const ep = endpoint({ url: "https://acme.example/log" });
    api.endpoints.test.push(ep);
    const rows = [
      delivery(ep.id, {
        status: "failed",
        attempts: 3,
        last_status_code: 500,
        last_error: "non-2xx response",
        // relative to the test's own clock: fixtures' NOW is fixed at import, minutes before this test runs
        next_attempt_at: Math.floor(Date.now() / 1000) + 600,
        succeeded_at: null,
      }),
      delivery(ep.id, {
        status: "pending",
        attempts: 0,
        last_status_code: null,
        next_attempt_at: NOW + 5,
        succeeded_at: null,
      }),
      delivery(ep.id, {
        status: "abandoned",
        attempts: 12,
        last_status_code: null,
        last_error: "connection refused",
        next_attempt_at: null,
        succeeded_at: null,
      }),
      // a status newer than the dashboard's spec version renders as received (tolerant parsing)
      { ...delivery(ep.id), status: "quarantined" as never },
      ...Array.from({ length: 20 }, () => delivery(ep.id)),
    ];
    api.deliveries.set(ep.id, rows);
    await signIn(page, api, `/developers/webhooks/${ep.id}`);
    const table = page.getByTestId("deliveries-table");
    const row = (i: number) => table.locator("tbody tr").filter({ has: page.getByTestId(`delivery-${rows[i]?.id}`) });
    const first = row(0);
    await expect(first).toContainText("payment_intent.succeeded");
    await expect(first).toContainText(/failed/i);
    await expect(first).toContainText("HTTP 500");
    await expect(first).toContainText("non-2xx response");
    await expect(first).toContainText(/in (9|10) min/);
    await expect(row(1)).toContainText(/pending/i);
    await expect(row(2)).toContainText("connection refused");
    await expect(row(2)).toContainText(/abandoned/i);
    await expect(row(3)).toContainText(/quarantined/i);
    await expect(table.locator("tbody tr")).toHaveCount(20);
    expect(api.callsTo("listWebhookEndpointDeliveries")[0]?.query).toEqual({ limit: "20" });

    await page.getByRole("button", { name: "Next" }).click();
    await expect(table.locator("tbody tr")).toHaveCount(4);
    expect(api.callsTo("listWebhookEndpointDeliveries").at(-1)?.query).toEqual({
      limit: "20",
      starting_after: rows[19]?.id,
    });
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByTestId(`delivery-${rows[0]?.id}`)).toBeVisible();

    await page.getByTestId(`delivery-${rows[0]?.id}`).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/developers/events/${rows[0]?.event}`));
  });
});
