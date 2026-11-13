/**
 * Refunds E2E (mock-backed; harness fails on page errors / CSP violations). Test mode simulates the signed
 * transfer (no wallet, no broadcast); live mode signs the API's ERC-191 payload verbatim and submits it.
 */
import { mkdirSync } from "node:fs";
import { expect, signIn, test } from "../../../test/e2e/harness";
import { installFeatureMock, RefundsMock } from "./refunds.mock";

const SHOTS = "test-results/shots/dashboard-features";
const JUDGE_SHOTS = process.env.NP_SHOTS ?? "test-results/shots/dash-judge";
mkdirSync(JUDGE_SHOTS, { recursive: true });
test.use({ viewport: { width: 1440, height: 900 } });

test.describe("refunds", () => {
  test("test mode: review refund → simulate signed transfer → pending", async ({ page, api }) => {
    const mock = new RefundsMock();
    installFeatureMock(api, mock);
    const pi = api.intents.test[0];
    await signIn(page, api);
    await page.goto(`/payments/${pi?.id}/refund`);
    await expect(page.getByRole("heading", { name: "Review refund" })).toBeVisible();
    await expect(page.getByText("Available to refund:")).toContainText("2.000017 USDC");
    await expect(page.getByTestId("refund-amount")).toHaveValue("2.000017");
    await page.screenshot({ path: `${SHOTS}/refund-review-1440.png`, fullPage: true });
    await page.getByTestId("refund-amount").fill("3");
    await page.getByTestId("review-in-wallet").click();
    await expect(page.getByText("That is more than is available to refund.")).toBeVisible();
    await page.getByTestId("refund-amount").fill("1");
    await page.getByTestId("refund-fee-mode").selectOption("merchant_absorbs");
    await page.getByTestId("review-in-wallet").click();
    await expect(page).toHaveURL(/\/refunds\/re_.*review=1/);
    expect(api.callsTo("createRefund")[0]?.body).toMatchObject({ amount: "1000000", fee_mode: "merchant_absorbs" });
    await expect(page.getByTestId("simulate-return")).toBeVisible();
    await page.getByTestId("simulate-transfer").click();
    await expect(page.getByTestId("refund-status")).toHaveText("Pending");
    expect(api.callsTo("simulateRefundDeposit")).toHaveLength(1);
    await page.screenshot({ path: `${SHOTS}/refund-detail-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/refund-detail-390.png`, fullPage: true });
    await page.goto(`/payments/${pi?.id}/refund`);
    await expect(page.getByRole("heading", { name: "Review refund" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/refund-review-390.png`, fullPage: true });
  });

  test("test mode: the page follows a simulated transfer to Refunded without a reload", async ({ page, api }) => {
    const mock = new RefundsMock();
    // like the API: 202 at once, the refund changes a moment later (the read right after it is unchanged)
    mock.simulateLagReads = 2;
    mock.settleAfterReads = 0;
    installFeatureMock(api, mock);
    const pi = api.intents.test[0];
    await signIn(page, api);
    await page.goto(`/payments/${pi?.id}/refund`);
    await page.getByTestId("refund-amount").fill("1");
    await page.getByTestId("review-in-wallet").click();
    await page.getByTestId("simulate-transfer").click();
    // accepted, not applied yet: the page says it is confirming instead of asking for the wallet again
    await expect(page.getByTestId("simulate-confirming")).toContainText("This page updates by itself");
    await expect(page.getByTestId("refund-status")).toHaveText("Not submitted");
    await expect(page.getByText("Confirming", { exact: true })).toBeVisible();
    await expect(page.getByTestId("needs-signature")).toHaveCount(0);
    await expect(page.getByTestId("open-review")).toHaveCount(0);
    await page.screenshot({ path: `${JUDGE_SHOTS}/refund-simulated-confirming-1440.png`, fullPage: true });
    // no reload from here on
    await expect(page.getByTestId("refund-status")).toHaveText("Pending", { timeout: 15_000 });
    await expect(page.getByTestId("simulate-confirming")).toHaveCount(0);
    await expect(page.getByTestId("refund-status")).toHaveText("Refunded", { timeout: 15_000 });
    await expect(page.getByRole("cell", { name: "Refund complete" })).toBeVisible();
    await expect(page.getByTestId("view-return-tx")).toBeVisible();
    await page.screenshot({ path: `${JUDGE_SHOTS}/refund-simulated-refunded-1440.png`, fullPage: true });
    expect(api.callsTo("simulateRefundDeposit")).toHaveLength(1);
    // a final state is not read again
    const reads = api.callsTo("getRefund").length;
    await page.waitForTimeout(5_500);
    expect(api.callsTo("getRefund")).toHaveLength(reads);
  });

  test("test mode: a simulated transfer that never shows stops after 2 minutes and says so", async ({ page, api }) => {
    const mock = new RefundsMock();
    mock.simulateLagReads = Number.POSITIVE_INFINITY;
    installFeatureMock(api, mock);
    const pi = api.intents.test[0];
    await signIn(page, api);
    await page.goto(`/payments/${pi?.id}/refund`);
    await page.getByTestId("refund-amount").fill("1");
    await page.getByTestId("review-in-wallet").click();
    await page.clock.install();
    await page.getByTestId("simulate-transfer").click();
    await expect(page.getByTestId("simulate-confirming")).toBeVisible();
    await page.clock.runFor(121_000);
    await expect(page.getByTestId("simulate-timeout")).toContainText("Still confirming");
    await expect(page.getByTestId("simulate-confirming")).toHaveCount(0);
    await expect(page.getByTestId("open-review")).toBeVisible();
    await page.screenshot({ path: `${JUDGE_SHOTS}/refund-simulated-still-confirming-1440.png`, fullPage: true });
    // stopped: no more reads until "Check again"
    const reads = api.callsTo("getRefund").length;
    await page.clock.runFor(30_000);
    await page.waitForTimeout(300);
    expect(api.callsTo("getRefund")).toHaveLength(reads);
    await page.getByTestId("simulate-check-again").click();
    await expect(page.getByTestId("simulate-confirming")).toBeVisible();
    await page.clock.runFor(2_500);
    await expect.poll(() => api.callsTo("getRefund").length).toBeGreaterThan(reads);
  });

  test("live mode: signs exactly the ERC-191 payload and submits it; owner override needs step-up", async ({
    page,
    api,
  }) => {
    const mock = new RefundsMock();
    installFeatureMock(api, mock);
    const pi = { ...(api.intents.test[0] as object), livemode: true } as (typeof api.intents.live)[number];
    api.intents.live.push(pi);
    await signIn(page, api);
    await page.goto(`/payments/${pi.id}/refund?mode=live`);
    await page.getByTestId("refund-amount").fill("1");
    await page.getByTestId("review-in-wallet").click();
    await expect(page.getByTestId("sign-intent")).toBeVisible();
    const action = (mock.refunds.live[0]?.next_action ?? {}) as { payload: string };
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/refund-sign-1440.png`, fullPage: true });
    await page.getByRole("button", { name: "Connect EVM wallet" }).click();
    await page.getByRole("menuitem", { name: /Test EVM Wallet/ }).click();
    await expect(page.getByTestId("refund-status")).toHaveText("Pending");
    const calls = (await page.evaluate(() => (window as unknown as { __evmCalls: unknown[] }).__evmCalls)) as {
      method: string;
      params?: string[];
    }[];
    const sign = calls.find((c) => c.method === "personal_sign");
    expect(Buffer.from((sign?.params?.[0] ?? "").slice(2), "hex").toString("utf8")).toBe(action.payload);
    const body = api.callsTo("submitRefundTx")[0]?.body as { signed_intent: { standard: string; payload: string } };
    expect(body.signed_intent).toMatchObject({ standard: "erc191", payload: action.payload });

    // a second refund, then the owner-only address override (step-up)
    await page.goto(`/payments/${pi.id}/refund?mode=live`);
    await page.getByTestId("refund-amount").fill("0.5");
    await page.getByTestId("review-in-wallet").click();
    await page
      .getByRole("button", { name: "Close" })
      .first()
      .click()
      .catch(() => {});
    await page.keyboard.press("Escape");
    await page.getByTestId("override-recipient").click();
    await page.getByTestId("override-address").fill("new-payer.near");
    await page.getByTestId("override-reason").fill("Payer lost access to the original account");
    await page.getByTestId("confirm-override").click();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByText(/Address set by an owner/)).toBeVisible();
    expect(api.callsTo("updateRefundRecipient").length).toBeGreaterThanOrEqual(2); // 401 step_up_required, then replay
  });

  test("refund list and a verified refund", async ({ page, api }) => {
    const mock = new RefundsMock();
    installFeatureMock(api, mock);
    const r = mock.seedSucceeded("test", api.intents.test[0] as Record<string, unknown>);
    await signIn(page, api);
    await page.goto(`/refunds/${r.id}`);
    await expect(page.getByTestId("refund-status")).toHaveText("Refunded");
    await expect(page.getByRole("cell", { name: "Refund complete" })).toBeVisible();
    await page.goto("/refunds");
    await expect(page.getByRole("table", { name: "Refunds" })).toContainText("1.00");
    await page.screenshot({ path: `${SHOTS}/refunds-list-1440.png`, fullPage: true });
  });
});
