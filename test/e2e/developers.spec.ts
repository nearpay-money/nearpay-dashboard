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

    page.on("dialog", (d) => void d.accept());
    const before = api.keys.test.length;
    await page.getByRole("button", { name: "Revoke" }).first().click();
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
    await expect(page.getByText("deliveries API")).toBeVisible();
    await page.getByRole("link", { name: "View event" }).click();
    await expect(page.getByTestId("event-json")).toContainText('"type": "ping"');
    await page.getByRole("link", { name: "Events" }).click();
    await expect(page.getByTestId("events-table")).toContainText("payment_intent.succeeded");
    await page.getByLabel("Type").selectOption("ping");
    await expect(page.getByTestId("events-table")).not.toContainText("payment_intent.succeeded");
    expect(api.callsTo("listEvents").at(-1)?.query).toMatchObject({ type: "ping" });
    await page.getByRole("link", { name: "Webhooks" }).click();
    await page.getByRole("link", { name: "https://acme.example/hooks" }).click();
    page.on("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/developers\/webhooks$/);
    await expect(page.getByText("No test endpoints yet.")).toBeVisible();
  });
});
