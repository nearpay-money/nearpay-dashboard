/** Customers E2E (mock-backed): list with totals, add, detail, edit, delete. */
import { expect, signIn, test } from "../../../test/e2e/harness";
import { CustomersMock, installFeatureMock } from "./customers.mock";

const SHOTS = "test-results/shots/dashboard-features";
test.use({ viewport: { width: 1440, height: 900 } });

test("customers: list → add → detail → delete", async ({ page, api }) => {
  const mock = new CustomersMock();
  installFeatureMock(api, mock);
  mock.seed("test");
  mock.seed("test", { name: "Atlas Studio", email: "ap@atlas.example", wallets: [] });
  await signIn(page, api);
  await page.goto("/customers");
  await expect(page.getByRole("table", { name: "Customers" })).toContainText("Northstar Labs");
  await expect(page.getByText("Wallet-only checkout")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/customers-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/customers-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("add-customer").click();
  await page.getByTestId("save-customer").click();
  await expect(page.getByText("Add at least a name, an email or a wallet.")).toBeVisible();
  await page.getByTestId("customer-name").fill("Orbit Tools");
  await page.getByTestId("customer-email").fill("hello@orbit.example");
  await page.getByTestId("save-customer").click();
  await expect(page).toHaveURL(/\/customers\/cus_/);
  await expect(page.getByRole("heading", { name: "Orbit Tools" })).toBeVisible();
  expect(api.callsTo("createCustomer")[0]?.body).toEqual({ name: "Orbit Tools", email: "hello@orbit.example" });
  await page.screenshot({ path: `${SHOTS}/customer-detail-1440.png`, fullPage: true });
  await page.getByTestId("delete-customer").click();
  await page.getByTestId("confirm-delete-customer").click();
  await expect(page).toHaveURL(/\/customers$/);
  expect(api.callsTo("deleteCustomer")).toHaveLength(1);
});
