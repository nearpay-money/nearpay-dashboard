/**
 * Refunds E2E (mock-backed; harness fails on page errors / CSP violations). Test mode simulates the signed
 * transfer (no wallet, no broadcast); live mode signs the API's ERC-191 payload verbatim and submits it.
 */
import { expect, signIn, test } from "../../../test/e2e/harness";
import { installFeatureMock, RefundsMock } from "./refunds.mock";

const SHOTS = "/home/claude/shots/dashboard-features";
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
    await page.getByRole("button", { name: "Sign with Test EVM Wallet" }).click();
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
