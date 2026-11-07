/** Payment links E2E (mock-backed): list, create with live preview, share URL, deactivate. */
import { expect, signIn, test } from "../../../test/e2e/harness";
import { installFeatureMock, PaymentLinksMock } from "./payment-links.mock";

const SHOTS = "/home/claude/shots/dashboard-features";
test.use({ viewport: { width: 1440, height: 900 } });

test("payment links: empty → create (preview) → detail → deactivate", async ({ page, api }) => {
  const mock = new PaymentLinksMock();
  installFeatureMock(api, mock);
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
