/**
 * Business details E2E (mock-backed): required fields, draft, declaration, save with step-up → live at
 * once (open onboarding, ADR-0024; registration number optional); manual mode still shows "submitted".
 */
import { expect, signIn, test } from "../../../test/e2e/harness";
import { installFeatureMock, KybMock } from "./kyb.mock";

const SHOTS = "test-results/shots/dashboard-features";
test.use({ viewport: { width: 1440, height: 900 } });

test("business details: validate → save draft → save and go live (step-up), no register number", async ({
  page,
  api,
}) => {
  const mock = new KybMock();
  installFeatureMock(api, mock);
  await signIn(page, api);
  await page.goto("/settings/business");
  // no "not submitted" status card before the details are saved; the form is shown straight away
  await expect(page.getByTestId("kyb-legal_name")).toBeVisible();
  await expect(page.getByTestId("kyb-status")).toHaveCount(0);
  await expect(page.getByText("Not submitted")).toHaveCount(0);
  await expect(page.getByText(/Save a draft any time/)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/kyb-1440.png`, fullPage: true });
  await page.getByTestId("kyb-submit").click();
  await expect(page.getByText("Enter the registered legal name.")).toBeVisible();
  await page.getByTestId("kyb-legal_name").fill("Acme Studio Ltd");
  await page.getByTestId("kyb-save").click();
  await expect.poll(() => api.callsTo("updateKybProfile").length).toBe(1);
  await page.getByTestId("kyb-country_of_incorporation").selectOption("GB");
  await page.getByTestId("kyb-business_type").selectOption("company");
  await page.getByTestId("kyb-expected_monthly_volume").selectOption("under_10k");
  await page.getByTestId("kyb-line1").fill("1 High Street");
  await page.getByTestId("kyb-city").fill("London");
  await page.getByTestId("kyb-address_country").selectOption("GB");
  await page.getByTestId("kyb-rep_name").fill("Alex Morgan");
  await page.getByTestId("kyb-rep_title").fill("Director");
  await page.getByTestId("kyb-declaration").check();
  await page.getByTestId("kyb-submit").click();
  await page.getByRole("button", { name: "Confirm with passkey" }).click();
  await expect(page.getByTestId("kyb-status")).toContainText("You're live — you can accept real payments");
  await expect(page.getByText(/verified|under review|pending review/i)).toHaveCount(0);
  await expect(page.getByText("Not provided")).toBeVisible(); // registration number left empty
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/kyb-390.png`, fullPage: true });
});

test("business details in manual review mode: submitted, no waiting-for-review copy", async ({ page, api }) => {
  installFeatureMock(api, new KybMock(true));
  await signIn(page, api);
  await page.goto("/settings/business");
  await page.getByTestId("kyb-legal_name").fill("Acme Studio Ltd");
  await page.getByTestId("kyb-country_of_incorporation").selectOption("GB");
  await page.getByTestId("kyb-business_type").selectOption("company");
  await page.getByTestId("kyb-expected_monthly_volume").selectOption("under_10k");
  await page.getByTestId("kyb-line1").fill("1 High Street");
  await page.getByTestId("kyb-city").fill("London");
  await page.getByTestId("kyb-address_country").selectOption("GB");
  await page.getByTestId("kyb-rep_name").fill("Alex Morgan");
  await page.getByTestId("kyb-rep_title").fill("Director");
  await page.getByTestId("kyb-declaration").check();
  await page.getByTestId("kyb-submit").click();
  await page.getByRole("button", { name: "Confirm with passkey" }).click();
  await expect(page.getByTestId("kyb-status")).toContainText("Your details are submitted");
  await expect(page.getByText(/under review/i)).toHaveCount(0);
});
