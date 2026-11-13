/** Checkout appearance E2E (mock-backed): live preview themed via CSSOM, save to account branding. */
import { expect, signIn, test } from "../../../test/e2e/harness";

const SHOTS = "test-results/shots/dashboard-features";
test.use({ viewport: { width: 1440, height: 900 } });

test("appearance: preview follows the accent and saves branding", async ({ page, api }) => {
  await signIn(page, api);
  await page.goto("/settings/appearance");
  await expect(page.getByTestId("save-appearance")).toHaveText("Saved");
  await page.getByRole("button", { name: "Violet #6D28D9" }).click();
  const accent = await page
    .getByTestId("appearance-preview")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--np-color-accent").trim().toLowerCase());
  expect(accent).toBe("#6d28d9");
  await page.screenshot({ path: `${SHOTS}/appearance-1440.png`, fullPage: true });
  await page.getByTestId("save-appearance").click();
  await expect(page.getByTestId("save-appearance")).toHaveText("Saved");
  expect(api.callsTo("updateAccount").at(-1)?.body).toEqual({ settings: { branding: { accent_color: "#6D28D9" } } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/appearance-390.png`, fullPage: true });
});
