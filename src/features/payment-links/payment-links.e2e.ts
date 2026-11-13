/**
 * Payment links E2E (mock-backed): list, create with live preview, share URL, deactivate; a link needs an
 * active payout wallet (the mock answers `409 destination_not_active` like the API).
 */
import { mkdirSync } from "node:fs";
import { destination } from "../../../test/e2e/fixtures";
import { expect, signIn, test } from "../../../test/e2e/harness";
import { installFeatureMock, PaymentLinksMock } from "./payment-links.mock";

const SHOTS = "/home/claude/shots/dashboard-features";
const JUDGE_SHOTS = process.env.NP_SHOTS ?? "/home/claude/shots/dash-judge";
mkdirSync(JUDGE_SHOTS, { recursive: true });
test.use({ viewport: { width: 1440, height: 900 } });

test("create a payment link without a payout wallet: asks for one first, with a link to add it", async ({
  page,
  api,
}) => {
  installFeatureMock(api, new PaymentLinksMock());
  await signIn(page, api, "/payment-links/new");
  const notice = page.getByTestId("payout-wallet-needed");
  await expect(notice).toContainText("Add a payout wallet first");
  await expect(notice).toContainText("This account has no active payout wallet in test mode yet.");
  await expect(page.getByText(/destination/i)).toHaveCount(0);
  await page.getByTestId("link-title").fill("Judge sticker");
  await page.getByTestId("link-amount").fill("5");
  await page.screenshot({ path: `${JUDGE_SHOTS}/payment-link-needs-payout-wallet-1440.png`, fullPage: true });
  // "Create link" sends nothing and says the same under the button
  await page.getByTestId("create-link").click();
  await expect(page.getByTestId("payout-wallet-error")).toContainText("Add a payout wallet first");
  await expect(page.getByText(/destination/i)).toHaveCount(0);
  expect(api.callsTo("createPaymentLink")).toHaveLength(0);
  await page.screenshot({ path: `${JUDGE_SHOTS}/payment-link-needs-payout-wallet-submit-1440.png`, fullPage: true });
  await notice.getByRole("link", { name: "Add a payout wallet" }).click();
  await expect(page).toHaveURL(/\/settlement\/new$/);
  await expect(page.getByRole("heading", { name: "Add a payout wallet" })).toBeVisible();

  // with an active payout wallet the notice is gone and the link can be created
  api.destinations.test.push(destination({ label: "Treasury" }));
  await page.goto("/payment-links/new");
  await expect(page.getByText("Only active payout wallets can receive payments.")).toBeVisible();
  await expect(page.getByTestId("payout-wallet-needed")).toHaveCount(0);
  await page.getByTestId("link-title").fill("Judge sticker");
  await page.getByTestId("link-amount").fill("5");
  await page.getByTestId("create-link").click();
  await expect(page).toHaveURL(/\/payment-links\/plink_/);
});

test("create a payment link: the API's destination_not_active answer names the payout wallet and links to add one", async ({
  page,
  api,
}) => {
  installFeatureMock(api, new PaymentLinksMock());
  // an active wallet exists, but none is the account default
  api.destinations.test.push(destination({ label: "Ops", is_default: false }));
  await signIn(page, api, "/payment-links/new");
  await expect(page.getByTestId("payout-wallet-needed")).toHaveCount(0);
  await page.getByTestId("link-title").fill("Judge sticker");
  await page.getByTestId("link-amount").fill("5");
  await page.getByTestId("create-link").click();
  const error = page.getByTestId("payout-wallet-error");
  await expect(error).toContainText("No active payout wallet can receive this link's payments.");
  await expect(error).not.toContainText(/destination/i);
  await expect(error.getByRole("link", { name: "Add a payout wallet" })).toHaveAttribute("href", "/settlement/new");
  await page.screenshot({ path: `${JUDGE_SHOTS}/payment-link-payout-wallet-error-1440.png`, fullPage: true });
});

test("payment links: empty → create (preview) → detail → deactivate", async ({ page, api }) => {
  const mock = new PaymentLinksMock();
  installFeatureMock(api, mock);
  api.destinations.test.push(destination({ label: "Treasury" }));
  await signIn(page, api);
  await page.goto("/payment-links");
  await expect(page.getByText("No test payment links yet")).toBeVisible();
  await page.getByTestId("new-link").click();
  await expect(page).toHaveURL(/\/payment-links\/new$/);
  await page.getByTestId("link-title").fill("Acme Pro");
  await page.getByTestId("link-amount").fill("49");
  await expect(page.getByTestId("preview-price")).toHaveText("$49.00");
  await page.screenshot({ path: `${SHOTS}/payment-link-create-1440.png`, fullPage: true });
  await page.getByTestId("create-link").click();
  await expect(page).toHaveURL(/\/payment-links\/plink_/);
  expect(api.callsTo("createPaymentLink")[0]?.body).toMatchObject({
    amount: 4900,
    currency: "usd",
    description: "Acme Pro",
  });
  await expect(page.getByText("https://pay.nearpay.localhost/l/plink_").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/payment-link-detail-1440.png`, fullPage: true });
  await page.getByTestId("deactivate-link").click();
  await page.getByTestId("confirm-deactivate").click();
  await expect(page.getByTestId("link-status")).toHaveText("Disabled");
  expect(api.callsTo("updatePaymentLink")[0]?.body).toEqual({ active: false });
  mock.seed("test", { description: "Team onboarding", amount: 24900, uses: 24 });
  mock.seed("test", { description: "Consultation", amount: 10000, uses: 9 });
  await page.goto("/payment-links");
  await expect(page.getByRole("table", { name: "Payment links" })).toContainText("$249.00");
  await page.screenshot({ path: `${SHOTS}/payment-links-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/payment-links-390.png`, fullPage: true });
  await page.goto("/payment-links/new");
  await page.getByTestId("link-title").fill("Acme Pro");
  await page.screenshot({ path: `${SHOTS}/payment-link-create-390.png`, fullPage: true });
});
