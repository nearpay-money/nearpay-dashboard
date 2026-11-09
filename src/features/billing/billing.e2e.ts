/** Stage 3 billing E2E (mock-backed): hub, invoices, products & prices, tax rates, subscriptions, customer tabs. */
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { NOW } from "../../../test/e2e/fixtures";
import { expect, signIn, test } from "../../../test/e2e/harness";
import { MandatesMock } from "../mandates/mandates.mock";
import { BillingMock } from "./billing.mock";

const SHOTS = process.env.NP_SHOTS ?? "/home/claude/shots/dashboard";
mkdirSync(SHOTS, { recursive: true });
test.use({ viewport: { width: 1440, height: 900 } });

async function shots(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/${name}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
}

function seed(api: object) {
  const b = new BillingMock(api);
  new MandatesMock(api, b); // Stage 4: subscription pages look up mandates

  const northstar = b.customers.seed("test");
  const atlas = b.customers.seed("test", { name: "Atlas Studio", email: "ap@atlas.example", wallets: [] });
  const orbit = b.customers.seed("test", { name: "Orbit Tools", email: null, wallets: [] });
  const team = b.product("test", { name: "Acme Team plan", description: "Unlimited projects for your workspace" });
  const pro = b.product("test", { name: "Pro" });
  const teamOnce = b.price("test", team.id as string, { unit_amount: 24900 });
  const proMonthly = b.price("test", pro.id as string, {
    unit_amount: 4900,
    recurring: { interval: "month", interval_count: 1 },
  });
  const teamMonthly = b.price("test", team.id as string, {
    unit_amount: 24900,
    recurring: { interval: "month", interval_count: 1 },
  });
  const vat = b.taxRate("test", { display_name: "VAT", percentage: "19", jurisdiction: "DE", country: "DE" });
  const open = b.invoice("test", { customer: northstar.id as string, lines: [{ price: teamOnce.id as string }] });
  b.invoice("test", { customer: atlas.id as string, lines: [{ unit_amount: 12900, description: "Pro · November" }] });
  const late = b.invoice("test", {
    customer: orbit.id as string,
    lines: [{ unit_amount: 4900, description: "Pro · October" }],
  });
  for (const i of b.invoices.test) (b as unknown as { finalize(i: unknown): void }).finalize(i);
  late.due_date = NOW - 3 * 86_400;
  b.pay("test", b.invoices.test.find((i) => i.customer === atlas.id) as never);
  const draft = b.invoice("test", {
    customer: atlas.id as string,
    lines: [{ unit_amount: 5000, description: "Workshop" }],
  });
  b.subscription("test", {
    customer: northstar.id,
    items: [
      {
        id: "si_01jbz9k3m4n5p6q7r8s9t0aaaa",
        object: "subscription_item",
        price: teamMonthly,
        quantity: 1,
        tax_rates: null,
      },
    ],
    default_tax_rates: [vat.id],
    latest_invoice: open.id,
  });
  b.subscription("test", {
    customer: orbit.id,
    status: "past_due",
    items: [
      {
        id: "si_01jbz9k3m4n5p6q7r8s9t0aaab",
        object: "subscription_item",
        price: proMonthly,
        quantity: 1,
        tax_rates: null,
      },
    ],
    latest_invoice: late.id,
  });
  return { b, northstar, atlas, orbit, team, pro, teamOnce, proMonthly, vat, open, late, draft };
}

test("billing hub: stats, invoice list with status filter in the URL", async ({ page, api }) => {
  seed(api);
  await signIn(page, api, "/billing");
  const table = page.getByRole("table", { name: "Invoices" });
  await expect(table).toContainText("Northstar Labs");
  await expect(table).toContainText("Past due");
  await expect(page.locator(".dash-stats")).toContainText("Collected this month");
  await expect(page.locator(".dash-stats")).toContainText("$129.00");
  await expect(page.getByTestId("billing-tab-invoices")).toHaveAttribute("aria-current", "page");
  await shots(page, "billing-invoices");
  await page.getByTestId("invoice-status-filter").click();
  await page.getByRole("menuitemradio", { name: "Past due" }).click();
  await expect(page).toHaveURL(/status=past_due/);
  await expect(table).toContainText("Orbit Tools");
  await expect(table).not.toContainText("Atlas Studio");
  const q = api.callsTo("listInvoices").at(-1)?.query;
  expect(q?.status).toBe("open");
  expect(Number(q?.["due_date[lte]"])).toBeGreaterThan(NOW - 60);
});

test("create invoice: price + custom line, tax preview, finalize & get link, send limit, PDF, void", async ({
  page,
  api,
}) => {
  const s = seed(api);
  await signIn(page, api, "/billing/invoices/new");
  await page.getByTestId("invoice-customer").selectOption(s.northstar.id as string);
  await page
    .getByTestId("line-price")
    .first()
    .selectOption(s.teamOnce.id as string);
  await page.getByTestId("add-line").click();
  const second = page.getByTestId("invoice-line").nth(1);
  await second.getByTestId("line-description").fill("Onboarding workshop");
  await second.getByTestId("line-amount").fill("100.50");
  await page.getByLabel("VAT 19%").check();
  await page.getByTestId("invoice-memo").fill("Thank you for your business.");
  const summary = page.getByRole("complementary", { name: "Invoice summary" });
  // 249.00 + 100.50 = 349.50; VAT 19% per line: 47.31 + 19.10 (19.095 rounds half-up) = 66.41
  await expect(summary).toContainText("$349.50");
  await expect(summary).toContainText("$66.41");
  await expect(summary).toContainText("$415.91");
  await shots(page, "invoice-create");
  await page.getByTestId("finalize-and-link").click();
  await expect(page).toHaveURL(/\/billing\/invoices\/in_.*finalized=1/);
  const body = api.callsTo("createInvoice")[0]?.body as Record<string, unknown>;
  expect(body.lines).toEqual([
    { price: s.teamOnce.id, quantity: 1 },
    { unit_amount: 10050, description: "Onboarding workshop", quantity: 1 },
  ]);
  expect(body.default_tax_rates).toEqual([s.vat.id]);
  expect(api.callsTo("finalizeInvoice")).toHaveLength(1);
  await expect(page.getByRole("heading", { name: /^Invoice ACMECOT-/ })).toBeVisible();
  await expect(page.getByTestId("hosted-link")).toContainText("https://pay.nearpay.localhost/i/in_");
  await expect(page.getByTestId("send-status")).toContainText("once every 10 minutes");
  await shots(page, "invoice-detail");
  await page.getByTestId("send-invoice").click();
  await expect(page.getByTestId("send-status")).toContainText("Last emailed");
  await expect(page.getByTestId("send-invoice")).toBeDisabled();
  await expect(page.getByTestId("send-status")).toContainText("next send in");
  await expect(page.getByTestId("invoice-activity")).toContainText("Emailed to the customer");
  const download = page.waitForEvent("download");
  await page.getByTestId("download-pdf").click();
  expect((await download).suggestedFilename()).toMatch(/^ACMECOT-\d+\.pdf$/);
  await page.getByTestId("invoice-more").click();
  await page.getByRole("menuitem", { name: "Void invoice" }).click();
  await page.getByRole("button", { name: "Void invoice" }).click();
  await expect(page.getByTestId("invoice-detail").getByText("Void", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("send-invoice")).toHaveCount(0);
});

test("invoice: missing email, mark uncollectible, draft edit and delete, past due", async ({ page, api }) => {
  const s = seed(api);
  await signIn(page, api, `/billing/invoices/${s.late.id}`);
  await expect(page.getByRole("heading", { name: /^Invoice / })).toBeVisible();
  await expect(page.getByTestId("invoice-detail").getByText("Past due").first()).toBeVisible();
  await page.getByTestId("send-invoice").click();
  await expect(page.getByText("This customer has no email address")).toBeVisible();
  await page.getByTestId("invoice-more").click();
  await page.getByRole("menuitem", { name: "Mark uncollectible" }).click();
  await page.getByRole("button", { name: "Mark uncollectible" }).click();
  await expect(page.getByText("Marked uncollectible").first()).toBeVisible();
  // a draft: edit, save, delete
  await page.goto(`/billing/invoices/${s.draft.id}`);
  await expect(page.getByRole("heading", { name: "Draft invoice" })).toBeVisible();
  await page.getByTestId("edit-invoice").click();
  await expect(page.getByRole("heading", { name: "Edit draft invoice" })).toBeVisible();
  await page.getByTestId("line-quantity").first().fill("2");
  await page.getByTestId("save-draft").click();
  await expect(page).toHaveURL(new RegExp(`/billing/invoices/${s.draft.id}$`));
  expect(api.callsTo("updateInvoice")[0]?.body).toMatchObject({
    lines: [{ unit_amount: 5000, description: "Workshop", quantity: 2 }],
  });
  await expect(page.getByRole("table", { name: "Invoice items" })).toContainText("$100.00");
  await page.getByTestId("delete-invoice").click();
  await page.getByRole("button", { name: "Delete draft" }).last().click();
  await expect(page).toHaveURL(/\/billing$/);
});

test("invoice form validation keeps the user on the form", async ({ page, api }) => {
  seed(api);
  await signIn(page, api, "/billing/invoices/new");
  await page.getByTestId("save-draft").click();
  await expect(page.getByText("Choose the customer to bill.")).toBeVisible();
  await expect(page.getByText("Describe the line.")).toBeVisible();
  await expect(page.getByText("Check the highlighted fields.")).toBeVisible();
  expect(api.callsTo("createInvoice")).toHaveLength(0);
});

test("products & prices: add with a first price, add price, deactivate, archive", async ({ page, api }) => {
  seed(api);
  await signIn(page, api, "/billing/products");
  await expect(page.getByRole("table", { name: "Products" })).toContainText("$249.00/month");
  await shots(page, "billing-products");
  await page.getByTestId("add-product").click();
  const dlg = page.getByTestId("product-dialog");
  await dlg.getByTestId("product-name").fill("Consulting");
  await dlg.getByRole("radio", { name: "One-time" }).click();
  await dlg.getByTestId("price-amount").fill("150");
  await dlg.getByTestId("save-product").click();
  await expect(page).toHaveURL(/\/billing\/products\/prod_/);
  expect(api.callsTo("createPrice").at(-1)?.body).toMatchObject({ unit_amount: 15000, currency: "usd" });
  expect(api.callsTo("createPrice").at(-1)?.body).not.toHaveProperty("recurring");
  await expect(page.getByRole("table", { name: "Prices" })).toContainText("$150.00 one-time");
  await page.getByTestId("add-price").click();
  const pd = page.getByTestId("price-dialog");
  await pd.getByTestId("price-amount").fill("1,200");
  await pd.getByTestId("price-interval").selectOption("year");
  await pd.getByTestId("save-price").click();
  await expect(page.getByRole("table", { name: "Prices" })).toContainText("$1,200.00/year");
  expect(api.callsTo("createPrice").at(-1)?.body).toMatchObject({
    unit_amount: 120000,
    recurring: { interval: "year", interval_count: 1 },
  });
  await shots(page, "product-detail");
  await page.getByRole("button", { name: /Actions for \$150.00 one-time/ }).click();
  await page.getByRole("menuitem", { name: "Deactivate price" }).click();
  await expect(page.getByRole("table", { name: "Prices" })).toContainText("Inactive");
  await page.getByTestId("archive-product").click();
  await page.getByRole("button", { name: "Archive product" }).click();
  await expect(page.getByText("Archived").first()).toBeVisible();
  expect(api.callsTo("updateProduct").at(-1)?.body).toEqual({ active: false });
});

test("tax rates: exact percentage, inclusive/exclusive, worked example, archive", async ({ page, api }) => {
  seed(api);
  await signIn(page, api, "/billing/tax-rates");
  await expect(page.getByRole("table", { name: "Tax rates" })).toContainText("19%");
  await page.getByTestId("add-tax-rate").click();
  const d = page.getByTestId("tax-rate-dialog");
  await d.getByTestId("tax-name").fill("Sales tax");
  await d.getByTestId("tax-percentage").fill("8.87551");
  await d.getByTestId("save-tax-rate").click();
  await expect(d.getByText("Enter a percentage from 0 to 100 with up to 4 decimals")).toBeVisible();
  await d.getByTestId("tax-percentage").fill("8.875");
  await expect(d.getByTestId("tax-example")).toHaveText("On $100.00: $8.88 tax, $108.88 total.");
  await d.getByRole("radio", { name: /Inclusive/ }).click();
  await expect(d.getByTestId("tax-example")).toHaveText("A $100.00 price includes $8.15 tax ($91.85 before tax).");
  await d.getByLabel("Jurisdiction (optional)").fill("US-NY");
  await shots(page, "tax-rate-create");
  await d.getByTestId("save-tax-rate").click();
  await expect(page.getByRole("table", { name: "Tax rates" })).toContainText("8.875%");
  expect(api.callsTo("createTaxRate")[0]?.body).toEqual({
    display_name: "Sales tax",
    percentage: "8.875",
    inclusive: true,
    jurisdiction: "US-NY",
  });
  await page.getByRole("button", { name: "Actions for Sales tax 8.875%" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByRole("table", { name: "Tax rates" })).not.toContainText("Sales tax");
  await shots(page, "billing-tax-rates");
});

test("subscriptions: list, create, upcoming renewal, cancel at period end, undo, cancel now", async ({ page, api }) => {
  const s = seed(api);
  await signIn(page, api, "/billing/subscriptions");
  const t = page.getByRole("table", { name: "Subscriptions" });
  await expect(t).toContainText("Acme Team plan · $249.00/month");
  await expect(t).toContainText("Past due");
  await expect(page.getByText("No surprise charges")).toBeVisible();
  await shots(page, "billing-subscriptions");
  await page.getByTestId("new-subscription").click();
  await page.getByTestId("subscription-customer").selectOption(s.atlas.id as string);
  await page.getByTestId("item-price").selectOption(s.proMonthly.id as string);
  await page.getByLabel("VAT 19%").check();
  const summary = page.getByRole("complementary", { name: "Subscription summary" });
  await expect(summary).toContainText("Every month");
  await expect(summary).toContainText("$58.31");
  await expect(summary).toContainText("nothing is charged automatically");
  await shots(page, "subscription-create");
  await page.getByTestId("create-subscription").click();
  await expect(page).toHaveURL(/\/billing\/subscriptions\/sub_.*created=1/);
  expect(api.callsTo("createSubscription")[0]?.body).toEqual({
    customer: s.atlas.id,
    items: [{ price: s.proMonthly.id, quantity: 1 }],
    days_until_due: 7,
    default_tax_rates: [s.vat.id],
    dunning: { reminder_days: [-3, 0, 1, 3, 7], on_exhausted: "cancel" },
  });
  await expect(page.getByText("Waiting for the first payment")).toBeVisible();
  // the active one: upcoming renewal + dunning
  const active = s.b.subscriptions.test.find((x) => x.status === "active") as { id: string };
  await page.goto(`/billing/subscriptions/${active.id}`);
  await expect(page.getByTestId("upcoming-renewal")).toContainText("$296.31");
  await expect(page.getByTestId("dunning")).toContainText("of 5 sent");
  await shots(page, "subscription-detail");
  await page.getByTestId("cancel-menu").click();
  await page.getByRole("menuitem", { name: "Cancel at period end" }).click();
  await page.getByRole("button", { name: "Cancel at period end" }).click();
  await expect(page.getByText(/^Cancels on /).first()).toBeVisible();
  await expect(page.getByTestId("upcoming-renewal")).toContainText("No renewal");
  await page.getByTestId("undo-cancel").click();
  await page.getByRole("button", { name: "Keep subscription" }).click();
  await expect(page.getByTestId("upcoming-renewal")).toContainText("$296.31");
  expect(api.callsTo("updateSubscription").at(-1)?.body).toEqual({ cancel_at_period_end: false });
  await page.getByTestId("cancel-menu").click();
  await page.getByRole("menuitem", { name: "Cancel now" }).click();
  await page.getByRole("button", { name: "Cancel now" }).click();
  await expect(page.getByText("Canceled by you")).toBeVisible();
  expect(api.callsTo("cancelSubscription").at(-1)?.body).toEqual({ at_period_end: false });
});

test("customer detail: API totals and billing tabs", async ({ page, api }) => {
  const s = seed(api);
  (s.northstar as Record<string, unknown>).total_paid = [{ currency: "usd", asset_id: null, amount: 412000, count: 3 }];
  (s.northstar as Record<string, unknown>).last_payment_at = NOW - 3600;
  await signIn(page, api, `/customers/${s.northstar.id}`);
  await expect(page.getByText("$4,120.00")).toBeVisible();
  expect(
    api.callsTo("listPaymentIntents").filter((c) => c.query.customer === s.northstar.id && c.query.status),
  ).toHaveLength(0);
  await page.getByRole("tab", { name: "Invoices" }).click();
  await expect(page).toHaveURL(/tab=invoices/);
  await expect(page.getByRole("table", { name: "Invoices of this customer" })).toContainText("ACMECOT-");
  await page.getByRole("tab", { name: "Subscriptions" }).click();
  await expect(page.getByTestId("customer-subscriptions").getByRole("table")).toContainText("$249.00/month");
  await shots(page, "customer-billing-tabs");
});

test("roles: support reads billing but can't create invoices", async ({ page, api }) => {
  seed(api);
  api.role = "support";
  await signIn(page, api, "/billing");
  await expect(page.getByRole("table", { name: "Invoices" })).toBeVisible();
  await expect(page.getByTestId("create-invoice")).toHaveCount(0);
  await page.goto("/billing/invoices/new");
  await expect(page.getByText("Not available for your role")).toBeVisible();
});
