import { USDC_BASE, USDC_NEAR } from "./fixtures";
import { EVM_ADDRESS, expect, NEAR_ACCOUNT, signIn, test } from "./harness";

test.describe("home and settlement destinations", () => {
  test("Home shows the live-mode checklist and starts KYB", async ({ page, api }) => {
    await signIn(page, api);
    const list = page.getByTestId("requirements");
    await expect(list).toContainText("Verify your business");
    await page.getByRole("button", { name: "Start verification" }).click();
    await expect(list).toContainText("pending");
    expect(api.kybStarted).toBe(true);
    await expect(page.getByTestId("payments-table")).toContainText("$2.00");
    await expect(page.getByTestId("test-banner")).toBeVisible();
  });

  test("test destination: step-up, then active immediately", async ({ page, api }) => {
    await signIn(page, api);
    await page.getByRole("link", { name: "Settlement" }).click();
    await page.getByRole("link", { name: "Add destination" }).click();
    await page.getByLabel("Asset").selectOption(USDC_NEAR);
    await page.getByLabel("Intents account").fill("acme.near");
    await page.getByLabel("Label").fill("Test USDC");
    await page.getByRole("button", { name: "Add destination" }).click();
    // createSettlementDestination needs a fresh step-up
    await expect(page.getByRole("dialog", { name: "Confirm it's you" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByText("Active — payments can settle here now.")).toBeVisible();
    const creates = api.callsTo("createSettlementDestination");
    expect(creates).toHaveLength(2);
    expect(creates[0]?.headers["idempotency-key"]).toBe(creates[1]?.headers["idempotency-key"]);
    expect(creates[1]?.headers["x-csrf-token"]).toBe(api.csrf);
    expect(api.callsTo("stepUpVerify")).toHaveLength(1);
    await page.getByRole("link", { name: "Back to destinations" }).click();
    await expect(page.getByTestId("destinations-table")).toContainText("Test USDC");
  });

  test("live NEAR Intents destination: NEP-413 signature via NEAR Connect, cool-off, fingerprint", async ({
    page,
    api,
  }) => {
    await signIn(page, api);
    await page.getByRole("button", { name: "Live" }).click();
    await expect(page).toHaveURL(/mode=live/);
    await expect(page.getByTestId("live-banner")).toBeVisible();
    await page.getByRole("link", { name: "Add destination" }).click();
    await expect(page.getByRole("heading", { name: "Add a live settlement destination" })).toBeVisible();
    await page.getByLabel("Asset").selectOption(USDC_NEAR);
    await page.getByLabel("Intents account").fill(NEAR_ACCOUNT);
    await page.getByLabel("Label").fill("Live USDC");
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Add destination" }).click();
    await expect(page.getByTestId("challenge-message")).toContainText(`Address: ${NEAR_ACCOUNT}`);
    expect(api.callsTo("createSettlementDestination")[0]?.headers["nearpay-mode"]).toBe("live");
    await page.getByRole("button", { name: "Sign with NEAR wallet" }).click();
    await page.locator('.connect-item[data-type="test-near-wallet"]').click();
    await expect(page.getByText("Signature verified.")).toBeVisible();
    await expect(page.getByText("1WZ5-TFJZ-CM")).toBeVisible();
    const signed = (await page.evaluate(() => (window as unknown as { __nearCalls: unknown[] }).__nearCalls))[0] as {
      message: string;
      recipient: string;
      nonce: string;
    };
    const chl = [...api.callsTo("attestSettlementDestination")][0]?.body as { standard: string; public_key: string };
    expect(signed.recipient).toBe("nearpay.money");
    expect(signed.message).toContain("NearPay settlement destination\nAccount: acct_");
    expect(chl.standard).toBe("nep413");
    expect(chl.public_key).toMatch(/^ed25519:/);
    await page.getByRole("link", { name: "Back to destinations" }).click();
    await expect(page.getByTestId("cooloff")).toContainText("active in");
  });

  test("live EVM destination: EIP-191 personal_sign of the exact challenge", async ({ page, api }) => {
    await signIn(page, api, "/settlement/new?mode=live");
    await page.getByLabel("Type").selectOption("chain_address");
    await page.getByLabel("Asset").selectOption(USDC_BASE);
    await page.getByLabel("Address").fill(EVM_ADDRESS);
    await page.getByLabel("Label").fill("Base USDC");
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Add destination" }).click();
    const message = await page.getByTestId("challenge-message").textContent();
    await page.getByRole("button", { name: "Sign with EVM wallet" }).click();
    await page.getByRole("button", { name: "Sign with Test EVM Wallet" }).click();
    await expect(page.getByText("Signature verified.")).toBeVisible();
    const calls = (
      await page.evaluate(
        () => (window as unknown as { __evmCalls: { method: string; params?: string[] }[] }).__evmCalls,
      )
    ).filter((c) => c.method === "personal_sign");
    const hex = calls[0]?.params?.[0] ?? "";
    expect(Buffer.from(hex.slice(2), "hex").toString("utf8")).toBe(message);
    expect(calls[0]?.params?.[1]).toBe(EVM_ADDRESS);
    const body = api.callsTo("attestSettlementDestination")[0]?.body as { standard: string; signature: string };
    expect(body.standard).toBe("eip191");
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  test("refuses to sign with a wallet account that is not the destination", async ({ page, api }) => {
    await signIn(page, api, "/settlement/new?mode=live");
    await page.getByLabel("Asset").selectOption(USDC_NEAR);
    await page.getByLabel("Intents account").fill("someone-else.near");
    await page.getByLabel("Label").fill("Wrong");
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Add destination" }).click();
    await page.getByRole("button", { name: "Sign with NEAR wallet" }).click();
    await page.locator('.connect-item[data-type="test-near-wallet"]').click();
    await expect(page.getByRole("alert")).toContainText("switch it to someone-else.near");
    expect(api.callsTo("attestSettlementDestination")).toHaveLength(0);
  });

  test("set default and disable destinations (step-up already fresh)", async ({ page, api }) => {
    api.destinations.test.push(
      (await import("./fixtures")).destination({ label: "Primary" }),
      (await import("./fixtures")).destination({ label: "Secondary", is_default: false }),
    );
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await signIn(page, api, "/settlement");
    page.on("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Make default" }).click();
    await expect(page.getByRole("button", { name: "Make default" })).toHaveCount(1);
    await page.getByRole("button", { name: "Disable" }).first().click();
    await expect(page.getByTestId("destinations-table")).toContainText("disabled");
    expect(api.callsTo("disableSettlementDestination")).toHaveLength(1);
  });
});
