/**
 * NEAR Intents account given as a `0x` address (judge run 2026-11-13, finding 4): wallets show the mixed-case
 * checksum form, the API accepts lower case only (the mock refuses mixed case like the API does). The form
 * sends the lower-case value and shows it before the request. The "Address on <network>" type is not re-cased.
 */
import { mkdirSync } from "node:fs";
import { USDC_BASE, USDC_NEAR } from "../../../test/e2e/fixtures";
import { expect, signIn, test } from "../../../test/e2e/harness";

const SHOTS = process.env.NP_SHOTS ?? "test-results/shots/dash-judge";
mkdirSync(SHOTS, { recursive: true });
test.use({ viewport: { width: 1440, height: 900 } });

const CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const LOWER = CHECKSUMMED.toLowerCase();

test("NEAR Intents account: a checksummed 0x address is saved in lower case, and the form says so", async ({
  page,
  api,
}) => {
  api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
  await signIn(page, api, "/settlement/new");
  await page.getByLabel("Wallet name").fill("Treasury");
  await page.getByLabel("Currency").selectOption("USDC");
  await page.getByLabel("Network", { exact: true }).selectOption(USDC_NEAR);
  await page.getByLabel("NEAR Intents account", { exact: true }).fill("merchant.near");
  await expect(page.getByTestId("address-note")).toHaveCount(0);
  await page.getByLabel("NEAR Intents account", { exact: true }).fill(CHECKSUMMED);
  await expect(page.getByTestId("address-note")).toContainText("Saved in lower case");
  await expect(page.getByTestId("address-note")).toContainText(LOWER);
  await page.screenshot({ path: `${SHOTS}/payout-wallet-0x-lower-case-note-1440.png`, fullPage: true });
  await page.getByRole("button", { name: "Add payout wallet" }).click();
  await expect(page.getByText("Payout wallet active")).toBeVisible();
  await expect(page.getByText(LOWER)).toBeVisible();
  expect(api.callsTo("createSettlementDestination")[0]?.body).toMatchObject({
    type: "intents_account",
    address: LOWER,
  });
  await page.screenshot({ path: `${SHOTS}/payout-wallet-0x-saved-1440.png`, fullPage: true });
});

test("Address on a network: the address is sent exactly as typed", async ({ page, api }) => {
  api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
  await signIn(page, api, "/settlement/new");
  await page.getByLabel("Wallet name").fill("Base wallet");
  await page.getByLabel("Currency").selectOption("USDC");
  await page.getByLabel("Network", { exact: true }).selectOption(USDC_BASE);
  await page.getByRole("radio", { name: /Address on/ }).check();
  await page.getByLabel("Wallet address").fill(CHECKSUMMED);
  await expect(page.getByTestId("address-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Add payout wallet" }).click();
  await expect(page.getByText("Payout wallet active")).toBeVisible();
  expect(api.callsTo("createSettlementDestination")[0]?.body).toMatchObject({
    type: "chain_address",
    address: CHECKSUMMED,
  });
});
