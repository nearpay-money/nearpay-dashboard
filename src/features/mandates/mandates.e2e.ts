/**
 * Stage 4 auto-debit E2E (mock-backed, spec 0.4.0): Billing → Auto-debit list with
 * filters, mandate page (collections with evidence, keeper failures, test helpers), merchant cancel signed
 * with the NEAR wallet (exact prepared transaction), the subscription panel (linked mandate, amount lock,
 * setup link, prepared funding, simulated funding), create with auto-debit + eligibility, switching the
 * collection method, unlinked mandates, `mandate.*` in Developers. CSP guard via the harness.
 */
import { mkdirSync } from "node:fs";
import { API_VERSION } from "@nearpay/spec";
import type { Page } from "@playwright/test";
import { destination, NOW } from "../../../test/e2e/fixtures";
import { expect, NEAR_ACCOUNT, signIn, test } from "../../../test/e2e/harness";
import type { MockApi } from "../../../test/e2e/mock-api";
import { BillingMock } from "../billing/billing.mock";
import { MandatesMock, MONTH, txHash } from "./mandates.mock";

const SHOTS = process.env.NP_SHOTS ?? "/home/claude/shots/dashboard-4.3";
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

type Mode = "test" | "live";

function seed(api: MockApi, mode: Mode = "test") {
  const b = new BillingMock(api);
  const md = new MandatesMock(api, b);
  const northstar = b.customers.seed(mode);
  const atlas = b.customers.seed(mode, { name: "Atlas Studio", email: "ap@atlas.example", wallets: [] });
  const orbit = b.customers.seed(mode, { name: "Orbit Tools", email: "billing@orbit.example", wallets: [] });
  const pro = b.product(mode, { name: "Pro" });
  const proMonthly = b.price(mode, pro.id as string, {
    unit_amount: 4900,
    recurring: { interval: "month", interval_count: 1 },
  });
  const eurMonthly = b.price(mode, pro.id as string, {
    unit_amount: 3900,
    currency: "eur",
    nickname: "EU",
    recurring: { interval: "month", interval_count: 1 },
  });
  const item = (id: string) => ({ id, object: "subscription_item", price: proMonthly, quantity: 1, tax_rates: null });
  // A: auto-debit, linked mandate with two collections and failing keeper attempts
  const subA = b.subscription(mode, {
    customer: northstar.id,
    collection_method: "auto_debit",
    items: [item("si_01jbz9k3m4n5p6q7r8s9t0aaaa")],
  });
  const mA = md.mandate(mode, subA, { collected_periods: 2, collect_failures: 2, onchain_id: 7 });
  md.collection(mode, mA, 1, NOW - 32 * 86_400);
  mA.last_collection = md.collection(mode, mA, 2, NOW - 2 * 86_400);
  // B: auto-debit, waiting for funding, open first invoice; an unlinked mandate with a wrong amount
  const subB = b.subscription(mode, {
    customer: atlas.id,
    status: "incomplete",
    collection_method: "auto_debit",
    items: [item("si_01jbz9k3m4n5p6q7r8s9t0aaab")],
  });
  const openB = b.invoice(mode, {
    customer: atlas.id as string,
    subscription: subB.id as string,
    billing_reason: "subscription_create",
    lines: [{ price: proMonthly.id as string }],
  });
  (b as unknown as { finalize(i: unknown): void }).finalize(openB);
  subB.latest_invoice = openB.id;
  md.mandate(mode, subB, {
    link_status: "unlinked",
    unlinked_reason: "amount_mismatch",
    collecting: false,
    payer: "bob.near",
    amount_per_period: "1000000",
    balance: "3000000",
    funded_periods: 3,
    collected_periods: 0,
    next_collect_at: null,
    sequence: 1,
  });
  // C: emailed invoices; a canceled mandate from an earlier auto-debit period
  const subC = b.subscription(mode, { customer: orbit.id, items: [item("si_01jbz9k3m4n5p6q7r8s9t0aaac")] });
  md.mandate(mode, subC, {
    status: "canceled",
    collecting: false,
    payer: "carol.near",
    balance: "0",
    funded_periods: 0,
    next_collect_at: null,
    canceled: { by: "carol.near", by_role: "payer", refunded: "49000000", canceled_at: NOW - 86_400 },
  });
  delete subC.mandate;
  return { b, md, northstar, atlas, orbit, proMonthly, eurMonthly, subA, subB, subC, mA };
}

test("auto-debit tab: mandates with status, link and payer filters in the URL", async ({ page, api }) => {
  seed(api);
  await signIn(page, api, "/billing/mandates");
  await expect(page.getByTestId("billing-tab-mandates")).toHaveAttribute("aria-current", "page");
  const table = page.getByRole("table", { name: "Mandates" });
  await expect(table).toContainText("Northstar Labs");
  await expect(table).toContainText("49 USDC / month");
  await expect(table).toContainText("Unlinked");
  await expect(table).toContainText("Canceled");
  await shots(page, "mandates-list");
  await page.getByTestId("mandate-link-filter").click();
  await page.getByRole("menuitemradio", { name: "Unlinked" }).click();
  await expect(page).toHaveURL(/link=unlinked/);
  await expect(table).toContainText("bob.near");
  await expect(table).not.toContainText("Northstar Labs");
  expect(api.callsTo("listMandates").at(-1)?.query.link_status).toBe("unlinked");
  await page.getByTestId("mandate-payer-search").fill("alice.near");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/payer=alice\.near/);
  await expect(page.getByText("No mandates match these filters.")).toBeVisible();
});

test("mandate page: balance, collections with evidence, keeper failures, test helpers", async ({ page, api }) => {
  const s = seed(api);
  await signIn(page, api, `/billing/mandates/${s.mA.id}`);
  const d = page.getByTestId("mandate-detail");
  await expect(d.locator(".dash-stats")).toContainText("98 USDC");
  await expect(d.locator(".dash-stats")).toContainText("2 periods left at 49 USDC");
  await expect(page.getByTestId("keeper-notice")).toContainText("2 of 5 so far");
  const coll = page.getByRole("table", { name: "Collections from this mandate" });
  await expect(coll.getByRole("row")).toHaveCount(3);
  await expect(coll).toContainText("Period 2");
  await expect(coll).toContainText("48.51 USDC");
  await expect(coll).toContainText("(sandbox)");
  await expect(page.getByTestId("mandate-terms")).toContainText("1% · 0.49 USDC per period");
  await shots(page, "mandate-detail");
  await page.getByRole("button", { name: "Top up one period" }).click();
  await expect(page.getByTestId("simulation-result")).toContainText("Accepted");
  expect(api.callsTo("simulateMandatePayerAction")[0]?.body).toEqual({ action: "top_up", periods: 1 });
});

test("merchant cancel (live): prepared cancel checked, signed verbatim with the receiving NEAR wallet", async ({
  page,
  api,
}) => {
  const s = seed(api, "live");
  await signIn(page, api, `/billing/mandates/${s.mA.id}?mode=live`);
  await page.getByTestId("cancel-mandate-open").click();
  const dlg = page.getByTestId("cancel-mandate");
  await expect(dlg).toContainText("NearPay can't cancel mandates");
  await page.getByTestId("prepare-cancel").click();
  await expect(dlg).toContainText("cancel(mandate 7)");
  await expect(dlg).toContainText("100 Tgas · 1 yoctoNEAR");
  await expect(dlg).toContainText("98 USDC");
  await shots(page, "mandate-cancel");
  await page.getByTestId("sign-cancel").click();
  await page.locator('.connect-item[data-type="test-near-wallet"]').click();
  await expect(dlg).toContainText("Cancel sent");
  const txs = await page.evaluate(() => (window as unknown as { __nearTxs: unknown[] }).__nearTxs);
  expect(txs).toEqual([
    {
      signerId: NEAR_ACCOUNT,
      receiverId: "v1.vault.nearpay.near",
      actions: [
        {
          type: "FunctionCall",
          params: { methodName: "cancel", args: { mandate_id: 7 }, gas: "100000000000000", deposit: "1" },
        },
      ],
    },
  ]);
  // the vault's `canceled` event reaches billing; the page follows the mirror (polls every 5 s)
  Object.assign(s.mA, {
    status: "canceled",
    collecting: false,
    next_collect_at: null,
    canceled: { by: NEAR_ACCOUNT, by_role: "merchant_receiver", refunded: "98000000", canceled_at: NOW },
    balance: "0",
    funded_periods: 0,
    sequence: 9,
  });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(/By your receiving account/)).toBeVisible({ timeout: 12_000 });
});

test("subscription panel: linked mandate and amount lock; setup link, prepared funding, simulated funding", async ({
  page,
  api,
}) => {
  const s = seed(api);
  await signIn(page, api, `/billing/subscriptions/${s.subA.id}`);
  const panel = page.getByTestId("subscription-mandate");
  await expect(panel).toContainText("98 USDC · 2 periods left");
  await expect(page.getByTestId("amount-locked")).toContainText("49 USDC every month");
  await expect(page.getByTestId("panel-keeper-notice")).toContainText("2 failed in a row");
  await shots(page, "subscription-auto-debit");

  await page.goto(`/billing/subscriptions/${s.subB.id}`);
  await expect(page.getByTestId("panel-unlinked")).toContainText("amount per period differs");
  await expect(page.getByTestId("setup-link")).toContainText("https://pay.nearpay.localhost/i/in_");
  await shots(page, "subscription-auto-debit-setup");
  await page.getByTestId("prepare-funding").click();
  await page.getByLabel("Fund up front").selectOption("6");
  await page.getByLabel("Token").selectOption({ label: "USDT" });
  await page.getByTestId("prepare-funding-submit").click();
  const dlg = page.getByTestId("funding-dialog");
  await expect(dlg).toContainText("294 USDT (6 periods)");
  await expect(dlg).toContainText("ft_transfer_call");
  await expect(dlg).toContainText("Relayer or gasless wallets");
  await expect(page.getByTestId("funding-instructions")).toContainText('choose "Set up auto-debit"');
  expect(api.callsTo("prepareMandate")[0]?.body).toEqual({
    subscription: s.subB.id,
    periods: 6,
    token: "usdt.tether-token.near",
  });
  expect(api.callsTo("prepareMandate")[0]?.headers["idempotency-key"]).toBeTruthy();
  await shots(page, "funding-dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("funding-dialog")).toHaveCount(0);
  await page.getByTestId("simulate-funding").click();
  await expect(page.getByTestId("linked-mandate-link")).toBeVisible();
  await expect(page.getByTestId("amount-locked")).toBeVisible();
});

test("prepare errors are explained; funding that doesn't match its terms is never shown", async ({ page, api }) => {
  const s = seed(api);
  s.md.prepareError = "vault_cap_exceeded";
  await signIn(page, api, `/billing/subscriptions/${s.subB.id}`);
  await page.getByTestId("prepare-funding").click();
  await page.getByTestId("prepare-funding-submit").click();
  await expect(page.getByTestId("funding-dialog")).toContainText("Choose fewer periods");
  await expect(page.getByTestId("funding-instructions")).toHaveCount(0);
});

test("new subscription: auto-debit with eligibility; EUR prices are refused before sending", async ({ page, api }) => {
  const s = seed(api);
  api.destinations.test.push(destination({ type: "intents_account", status: "active" }));
  await signIn(page, api, "/billing/subscriptions/new");
  await page.getByTestId("subscription-customer").selectOption(s.orbit.id as string);
  await page
    .getByTestId("item-price")
    .first()
    .selectOption(s.eurMonthly.id as string);
  await page.getByRole("radio", { name: /Auto-debit/ }).check();
  await page.getByTestId("create-subscription").click();
  await expect(page.getByTestId("auto-debit-eligibility")).toContainText("EUR prices can't be auto-debited");
  expect(api.callsTo("createSubscription")).toHaveLength(0);
  await page
    .getByTestId("item-price")
    .first()
    .selectOption(s.proMonthly.id as string);
  await expect(page.getByTestId("auto-debit-eligibility")).toContainText("USDC or USDT");
  await expect(page.getByRole("complementary", { name: "Subscription summary" })).toContainText("Auto-debit");
  await shots(page, "subscription-new-auto-debit");
  await page.getByTestId("create-subscription").click();
  await expect(page).toHaveURL(/\/billing\/subscriptions\/sub_.*created=1/);
  expect(
    (api.callsTo("createSubscription")[0]?.body as { collection_method?: string } | undefined)?.collection_method,
  ).toBe("auto_debit");
  await expect(page.getByTestId("mandate-setup")).toContainText("Waiting for the customer");
});

test("no NEAR Intents account: auto-debit explains and links to Settlement", async ({ page, api }) => {
  const s = seed(api);
  await signIn(page, api, "/billing/subscriptions/new");
  await page
    .getByTestId("item-price")
    .first()
    .selectOption(s.proMonthly.id as string);
  await page.getByRole("radio", { name: /Auto-debit/ }).check();
  const note = page.getByTestId("auto-debit-eligibility");
  await expect(note).toContainText("don't have an active one");
  await expect(note.getByRole("link", { name: "Add a NEAR Intents account" })).toHaveAttribute(
    "href",
    "/settlement/new",
  );
});

test("switch collection: leaving auto-debit releases the linked mandate", async ({ page, api }) => {
  const s = seed(api);
  await signIn(page, api, `/billing/subscriptions/${s.subA.id}`);
  await page.getByTestId("switch-collection").click();
  await expect(page.getByRole("dialog")).toContainText("releases it");
  await page.getByRole("button", { name: "Use emailed invoices" }).last().click();
  await expect(page.getByTestId("switch-collection")).toHaveText("Use auto-debit");
  expect(api.callsTo("updateSubscription")[0]?.body).toEqual({ collection_method: "send_invoice" });
  expect(s.mA.collecting).toBe(false);
  await expect(page.getByTestId("amount-locked")).toHaveCount(0);
});

test("roles: developers read mandates and use test helpers but can't cancel", async ({ page, api }) => {
  const s = seed(api);
  api.role = "developer";
  await signIn(page, api, `/billing/mandates/${s.mA.id}`);
  await expect(page.getByTestId("mandate-detail")).toBeVisible();
  await expect(page.getByTestId("cancel-mandate-open")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Top up one period" })).toBeEnabled();
});

test("developers: mandate.* events listed, filtered and linked to the mandate", async ({ page, api }) => {
  const s = seed(api);
  api.events.test.unshift({
    id: "evt_01jbz9k3m4n5p6q7r8s9tmd001",
    object: "event",
    type: "mandate.collected",
    api_version: API_VERSION,
    created: NOW,
    livemode: false,
    data: {
      object: {
        ...s.mA,
        period_secs: MONTH,
        last_collection: { ...(s.mA.last_collection as object), tx_hash: txHash() },
      },
    },
    request: { id: null, idempotency_key: null },
  } as never);
  await signIn(page, api, "/developers/events");
  const table = page.getByTestId("events-table");
  await expect(table).toContainText("mandate.collected");
  await page.getByLabel("Type").selectOption("mandate.collected");
  await expect(table).toContainText(String(s.mA.id).slice(0, 6));
  await page
    .getByRole("link", { name: /mandate\.collected/ })
    .first()
    .click();
  await page.getByRole("link", { name: String(s.mA.id) }).click();
  await expect(page).toHaveURL(new RegExp(`/billing/mandates/${s.mA.id}`));
});
