import { USDC_BASE, USDC_NEAR } from "./fixtures";
import { EVM_ADDRESS, expect, NEAR_ACCOUNT, signIn, test } from "./harness";

test.describe("home and settlement destinations", () => {
  test("Home shows payments; the checklist links to business details (self-declared KYB)", async ({ page, api }) => {
    await signIn(page, api);
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Acme Coffee$/ })).toBeVisible();
    await expect(page.getByTestId("payments-table")).toContainText("$2.00");
    // landing-showcase Home: three KPIs from real payments, recent payments with paid-with, chart by origin chain
    await expect(page.getByTestId("kpi-volume")).toContainText("Settled volume");
    await expect(page.getByTestId("kpi-succeeded")).toContainText(/of \d+ started/);
    await expect(page.getByTestId("kpi-median")).toContainText("Median time to paid");
    await expect(page.getByRole("img", { name: /Volume by source chain/ })).toContainText("");
    await expect(page.getByRole("list", { name: "Chains" })).toContainText("Base");
    await expect(page.getByTestId("payments-table")).toContainText("USDC on Base");
    await expect(page.getByRole("table", { name: "Recent payments" }).getByRole("columnheader")).toHaveText([
      "Amount",
      "Status",
      "Paid with",
      "Time",
    ]);
    await expect(page.getByText("Last 7 days, in USD. Funds settle straight to your payout wallet.")).toBeVisible();
    await expect(page.getByTestId("mode-switch").getByRole("radio", { name: "Test" })).toBeChecked();
    await expect(page.getByTestId("test-banner")).toBeVisible();
    await page.getByRole("link", { name: "View the checklist" }).click();
    const list = page.getByTestId("requirements");
    await expect(list).toContainText("Add your business details");
    await expect(list).not.toContainText("Verify your business");
    await expect(list.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/settings/business");
    await expect(list.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/settlement/new?mode=live");
  });

  test("first run: no payments and live mode off shows the onboarding checklist", async ({ page, api }) => {
    api.intents.test = [];
    await signIn(page, api);
    await expect(page.getByRole("heading", { name: "Let’s get you ready to accept payments." })).toBeVisible();
    await expect(page.getByText("Live payments are not active yet")).toBeVisible();
    await page.getByRole("button", { name: "View requirements" }).click();
    const reqs = page.getByRole("list", { name: "Live mode requirements" });
    await expect(reqs).toContainText("Business details saved");
    await expect(reqs).not.toContainText(/review/i);
    await expect(page.getByTestId("requirements")).toContainText("Live as soon as you save them.");
  });

  test("test destination: step-up, then active immediately", async ({ page, api }) => {
    await signIn(page, api);
    await page.getByRole("link", { name: "Payout wallets" }).click();
    await page.getByRole("link", { name: "Add payout wallet" }).click();
    await page.getByLabel("Currency").selectOption("USDC");
    await page.getByLabel("Network", { exact: true }).selectOption(USDC_NEAR);
    await page.getByLabel("NEAR Intents account", { exact: true }).fill("acme.near");
    await page.getByLabel("Wallet name").fill("Test USDC");
    await page.getByRole("button", { name: "Add payout wallet" }).click();
    // createSettlementDestination needs a fresh step-up
    await expect(page.getByRole("dialog", { name: "Confirm it's you" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByText("Payout wallet active")).toBeVisible();
    await expect(page.getByText("Test payments settle to this wallet now (sandbox only).")).toBeVisible();
    const creates = api.callsTo("createSettlementDestination");
    expect(creates).toHaveLength(2);
    expect(creates[0]?.headers["idempotency-key"]).toBe(creates[1]?.headers["idempotency-key"]);
    expect(creates[1]?.headers["x-csrf-token"]).toBe(api.csrf);
    expect(api.callsTo("stepUpVerify")).toHaveLength(1);
    await page.getByRole("link", { name: "Back to payout wallets" }).click();
    await expect(page.getByTestId("destinations-table")).toContainText("Test USDC");
  });

  test("live NEAR Intents destination: NEP-413 signature via NEAR Connect, active at once, fingerprint", async ({
    page,
    api,
  }) => {
    await signIn(page, api);
    await page.getByRole("radio", { name: "Live" }).click();
    await expect(page).toHaveURL(/mode=live/);
    await expect(page.getByTestId("live-banner")).toBeVisible();
    // no live payments and live mode off: Overview is the onboarding checklist; step 02 continues to a live destination
    await page.getByTestId("requirements").getByRole("link", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Add a payout wallet" })).toBeVisible();
    await expect(page.getByText("future live payments")).toBeVisible();
    await page.getByLabel("Currency").selectOption("USDC");
    await page.getByLabel("Network", { exact: true }).selectOption(USDC_NEAR);
    await page.getByLabel("NEAR Intents account", { exact: true }).fill(NEAR_ACCOUNT);
    await page.getByLabel("Wallet name").fill("Live USDC");
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Connect wallet & verify" }).click();
    await expect(page.getByTestId("challenge-message")).toContainText(`Address: ${NEAR_ACCOUNT}`);
    expect(api.callsTo("createSettlementDestination")[0]?.headers["nearpay-mode"]).toBe("live");
    await page.getByRole("button", { name: "Connect NEAR wallet" }).click();
    await page.locator('.connect-item[data-type="test-near-wallet"]').click();
    await expect(page.getByText("Payout wallet active")).toBeVisible();
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
    // active right away (owner decision 2026-11-11): no waiting copy anywhere in the default flow
    await expect(page.getByText(/cool-off|cooling off|security hold/i)).toHaveCount(0);
    await page.getByRole("link", { name: "Back to payout wallets" }).click();
    await expect(page.getByTestId("destinations-table")).toContainText("Active");
    await expect(page.getByTestId("activating")).toHaveCount(0);
    await expect(page.getByText(/cool-off|cooling off|security hold/i)).toHaveCount(0);
  });

  test("live EVM destination: EIP-191 personal_sign of the exact challenge", async ({ page, api }) => {
    await signIn(page, api, "/settlement/new?mode=live");
    await page.getByLabel("Currency").selectOption("USDC");
    await page.getByLabel("Network", { exact: true }).selectOption(USDC_BASE);
    await page.getByRole("radio", { name: /Address on Base/ }).check();
    await page.getByLabel("Wallet address").fill(EVM_ADDRESS);
    await page.getByLabel("Wallet name").fill("Base USDC");
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Connect wallet & verify" }).click();
    const message = await page.getByTestId("challenge-message").textContent();
    // wallet picker (menu button): keyboard opens it on the detected wallet, Esc closes and returns focus
    const trigger = page.getByRole("button", { name: "Connect EVM wallet" });
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    const item = menu.getByRole("menuitem", { name: /Test EVM Wallet/ });
    await expect(item).toBeFocused();
    await expect(item).toContainText("Detected");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowDown");
    await expect(item).toBeFocused();
    await page.getByTestId("challenge-message").click(); // click outside closes
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await expect(item).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Payout wallet active")).toBeVisible();
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

  test("EVM wallet picker: a wrong account shows the error and reopens the menu on that wallet", async ({
    page,
    api,
  }) => {
    const other = "0x1111111111111111111111111111111111111111";
    await signIn(page, api, "/settlement/new?mode=live");
    await page.getByLabel("Currency").selectOption("USDC");
    await page.getByLabel("Network", { exact: true }).selectOption(USDC_BASE);
    await page.getByRole("radio", { name: /Address on Base/ }).check();
    await page.getByLabel("Wallet address").fill(other);
    await page.getByLabel("Wallet name").fill("Base USDC");
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Connect wallet & verify" }).click();
    await page.getByRole("button", { name: "Connect EVM wallet" }).click();
    await page.getByRole("menuitem", { name: /Test EVM Wallet/ }).click();
    await expect(page.getByRole("alert")).toContainText(`switch it to ${other}`);
    const item = page.getByRole("menu").getByRole("menuitem", { name: /Test EVM Wallet/ });
    await expect(item).toBeFocused();
    await expect(item).toContainText("Tried last");
    await expect(page.getByRole("button", { name: "Connect EVM wallet" })).not.toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText(`switch it to ${other}`);
    expect(api.callsTo("attestSettlementDestination")).toHaveLength(0);
  });

  test("expired challenge: request a new one (step-up), then sign it (spec 0.1.5)", async ({ page, api }) => {
    await signIn(page, api, "/settlement/new?mode=live");
    await page.getByLabel("Currency").selectOption("USDC");
    await page.getByLabel("Network", { exact: true }).selectOption(USDC_NEAR);
    await page.getByLabel("NEAR Intents account", { exact: true }).fill(NEAR_ACCOUNT);
    await page.getByLabel("Wallet name").fill("Live USDC");
    api.challengeTtlS = -1; // the challenge issued on create is already expired
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Connect wallet & verify" }).click();
    await expect(page.getByText("The challenge expired.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect NEAR wallet" })).toHaveCount(0);
    const firstChallenge = await page.getByTestId("challenge-message").textContent();

    api.challengeTtlS = 600;
    api.stepUpUntil = 0; // challengeSettlementDestination needs a fresh step-up
    await page.getByRole("button", { name: "Request new challenge" }).click();
    await expect(page.getByRole("dialog", { name: "Confirm it's you" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(page.getByRole("button", { name: "Connect NEAR wallet" })).toBeVisible();
    const calls = api.callsTo("challengeSettlementDestination");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers["idempotency-key"]).toBe(calls[1]?.headers["idempotency-key"]);
    expect(calls[1]?.headers["x-csrf-token"]).toBe(api.csrf);
    expect(calls[1]?.body).toEqual({});
    await expect(page.getByTestId("challenge-message")).not.toHaveText(firstChallenge ?? "");

    // the attestation answers the latest challenge (earlier ones stop being accepted)
    const latest = api.challenges.get(api.destinations.live[0]?.id ?? "")?.id;
    await page.getByRole("button", { name: "Connect NEAR wallet" }).click();
    await page.locator('.connect-item[data-type="test-near-wallet"]').click();
    await expect(page.getByText("Payout wallet active")).toBeVisible();
    expect(api.callsTo("attestSettlementDestination")[0]?.body).toMatchObject({ challenge_id: latest });
  });

  test("a pending destination without its challenge (reload) gets one from the attest page", async ({ page, api }) => {
    const { destination } = await import("./fixtures");
    const d = destination({
      livemode: true,
      status: "pending_verification",
      verification: "signature",
      is_default: false,
      active_at: null,
      label: "Pending USDC",
      address: NEAR_ACCOUNT,
    });
    api.destinations.live.push(d);
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await signIn(page, api, "/settlement?mode=live");
    await page.getByRole("link", { name: "Sign" }).click();
    await expect(page).toHaveURL(new RegExp(`/settlement/${d.id}/attest`));
    await page.getByRole("button", { name: "Request signing challenge" }).click();
    await expect(page.getByTestId("challenge-message")).toContainText(`Address: ${NEAR_ACCOUNT}`);
    expect(api.callsTo("challengeSettlementDestination")[0]?.headers["nearpay-mode"]).toBe("live");
  });

  test("requesting a challenge for a destination that is no longer pending shows the conflict", async ({
    page,
    api,
  }) => {
    const { destination } = await import("./fixtures");
    const d = destination({
      livemode: true,
      status: "pending_verification",
      verification: "signature",
      is_default: false,
      active_at: null,
      address: NEAR_ACCOUNT,
    });
    api.destinations.live.push(d);
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await signIn(page, api, `/settlement/${d.id}/attest?mode=live`);
    await expect(page.getByRole("button", { name: "Request signing challenge" })).toBeVisible();
    d.status = "active"; // verified meanwhile (e.g. in another tab)
    await page.getByRole("button", { name: "Request signing challenge" }).click();
    await expect(page.getByRole("alert")).toContainText("state_conflict");
  });

  test("refuses to sign with a wallet account that is not the destination", async ({ page, api }) => {
    await signIn(page, api, "/settlement/new?mode=live");
    await page.getByLabel("Currency").selectOption("USDC");
    await page.getByLabel("Network", { exact: true }).selectOption(USDC_NEAR);
    await page.getByLabel("NEAR Intents account", { exact: true }).fill("someone-else.near");
    await page.getByLabel("Wallet name").fill("Wrong");
    api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
    await page.getByRole("button", { name: "Connect wallet & verify" }).click();
    await page.getByRole("button", { name: "Connect NEAR wallet" }).click();
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
    await page.getByRole("button", { name: "Make default" }).click();
    await expect(page.getByRole("button", { name: "Make default" })).toHaveCount(1);
    await page.getByRole("button", { name: "Disable", exact: true }).first().click();
    await page.getByRole("button", { name: "Disable destination" }).click();
    await expect(page.getByTestId("destinations-table")).toContainText("Disabled");
    expect(api.callsTo("disableSettlementDestination")).toHaveLength(1);
  });
});
