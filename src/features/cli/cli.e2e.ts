/** `/cli/authorize` E2E (mock-backed): device details, approve with step-up, deny, not found, already decided. */
import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "../../../test/e2e/harness";
import { BillingMock } from "../billing/billing.mock";

const SHOTS = process.env.NP_SHOTS ?? "test-results/shots/dashboard";
mkdirSync(SHOTS, { recursive: true });
test.use({ viewport: { width: 1440, height: 900 } });

/** Signs in through the UI and lands on the focused CLI page (no workspace shell there). */
async function signIn(page: Page, _api: unknown, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/signin\?next=/);
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page).toHaveURL(/\/cli\/authorize/);
}

test("approve: sign-in keeps the code, shows where it came from, approves with passkey step-up", async ({
  page,
  api,
}) => {
  const b = new BillingMock(api);
  b.cliLogin();
  await page.goto("/cli/authorize?code=bcdf-ghjk");
  await expect(page).toHaveURL(/\/signin\?next=/);
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page).toHaveURL(/\/cli\/authorize\?code=bcdf-ghjk/);
  const card = page.getByTestId("cli-authorize");
  await expect(card.getByTestId("cli-code")).toContainText("BCDF-GHJK");
  await expect(card).toContainText("adarsh-mbp");
  await expect(card).toContainText("203.0.113.24 · India");
  await expect(card).toContainText("nearpay-cli/0.3.0");
  await expect(card).toContainText("Only approve a login you just started");
  await expect(card).toContainText("test-mode API key");
  await expect(page.getByRole("navigation", { name: /main|workspace/i })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/cli-authorize-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}/cli-authorize-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("cli-approve").click();
  await page.getByRole("button", { name: "Confirm with passkey" }).click();
  await expect(card).toContainText("Approved. Return to your terminal");
  const calls = api.callsTo("approveCliLogin");
  expect(calls).toHaveLength(2); // 401 step_up_required, then the replay
  expect(calls[0]?.headers["idempotency-key"]).toBe(calls[1]?.headers["idempotency-key"]);
  await expect(card.getByRole("link", { name: "Developers → API keys" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/cli-authorize-approved-1440.png`, fullPage: true });
});

test("deny, canceled step-up, already decided (409) and expired", async ({ page, api }) => {
  const b = new BillingMock(api);
  b.cliLogin();
  b.cliLogin({ code: "MNPQ-RSTV", device_name: "ci-runner" });
  b.cliLogin({ code: "WXZB-CDFG", status: "expired", expires_at: Math.floor(Date.now() / 1000) - 10 });
  await signIn(page, api, "/cli/authorize?code=BCDF-GHJK");
  await page.getByTestId("cli-approve").click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Confirmation canceled")).toBeVisible();
  await page.getByTestId("cli-deny").click();
  await expect(page.getByTestId("cli-authorize")).toContainText("You denied this request");
  expect(api.callsTo("denyCliLogin")).toHaveLength(1);
  // someone else decided it in the meantime
  await page.goto("/cli/authorize?code=MNPQ-RSTV");
  await expect(page.getByTestId("cli-authorize")).toContainText("ci-runner");
  const l = b.cliLogins.get("MNPQ-RSTV");
  if (l) l.status = "denied";
  api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
  await page.getByTestId("cli-approve").click();
  await expect(page.getByText("This request was already handled")).toBeVisible();
  await expect(page.getByTestId("cli-authorize")).toContainText("You denied this request");
  await page.goto("/cli/authorize?code=WXZB-CDFG");
  await expect(page.getByTestId("cli-authorize")).toContainText("This request expired");
  await expect(page.getByTestId("cli-approve")).toHaveCount(0);
});

test("unknown or another account's code → 404 copy; no code → enter it", async ({ page, api }) => {
  const b = new BillingMock(api);
  b.cliLogin({ code: "HJKL-MNPQ", otherAccount: true });
  await signIn(page, api, "/cli/authorize?code=HJKL-MNPQ");
  await expect(page.getByRole("heading", { name: "Login request not found" })).toBeVisible();
  await expect(page.getByText(/started for another NearPay account/)).toBeVisible();
  await page.getByRole("link", { name: "Enter a different code" }).click();
  await page.getByTestId("cli-code-input").fill("aeio");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter the 8-letter code")).toBeVisible();
  b.cliLogin();
  await page.getByTestId("cli-code-input").fill("bcdf ghjk");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/code=BCDF-GHJK/);
  await expect(page.getByTestId("cli-authorize")).toContainText("adarsh-mbp");
});

test("roles without key access see an explanation", async ({ page, api }) => {
  new BillingMock(api).cliLogin();
  api.role = "finance";
  await signIn(page, api, "/cli/authorize?code=BCDF-GHJK");
  await expect(page.getByText("Only owners, admins and developers can connect the CLI.")).toBeVisible();
  expect(api.callsTo("getCliLogin")).toHaveLength(0);
});
