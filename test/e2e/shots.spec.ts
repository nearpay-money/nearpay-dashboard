/** Review screenshots (NP_SHOTS=<dir>): every main screen at 1440 and 390 px. Skipped in normal runs. */
import { agentPayment, apiKey, destination, endpoint, intent, NOW, SOL_SOLANA, USDC_NEAR } from "./fixtures";
import { expect, signIn, test } from "./harness";

const DIR = process.env.NP_SHOTS;

test.describe("screenshots", () => {
  test.skip(!DIR, "set NP_SHOTS to a directory to take review screenshots");
  for (const width of [1440, 390]) {
    test(`main screens at ${width}px`, async ({ page, api }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: width > 900 ? 1000 : 844 });
      const day = 86_400;
      // where customers paid from: Base (fixture default), Solana and NEAR
      const from = (pi: ReturnType<typeof intent>, i: number) => {
        const a = pi.attempts[0];
        if (a && i % 3 === 1)
          Object.assign(a, { origin_chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", origin_asset_id: SOL_SOLANA });
        if (a && i % 4 === 2) Object.assign(a, { origin_chain: "near:mainnet", origin_asset_id: USDC_NEAR });
        return pi;
      };
      api.intents.test.push(
        ...Array.from({ length: 12 }, (_, i) =>
          from(
            intent({
              created: NOW - i * day * 0.55 - 600,
              succeeded_at: NOW - i * day * 0.55 - 500,
              amount: 4900 + ((i * 3700) % 12000),
              description: ["Acme Pro", "Team plan", "Consultation"][i % 3] ?? "Acme Pro",
            }),
            i,
          ),
        ),
        intent({
          status: "requires_review",
          amount: 24900,
          description: "Annual plan",
          succeeded_at: null,
          review_reason: "short_settlement" as never,
        }),
        intent({
          status: "processing",
          amount: 12900,
          description: "Acme Pro",
          succeeded_at: null,
          amount_settled: "0",
          created: NOW - 7200,
        }),
      );
      api.destinations.test.push(
        destination({ label: "Treasury" }),
        destination({
          label: "Operations",
          is_default: false,
          status: "active",
          active_at: NOW - 3600,
          address: "ops.near",
        }),
        destination({
          label: "Base wallet",
          is_default: false,
          status: "pending_approval",
          type: "chain_address",
          chain: "eip155:8453",
          address: "0x8f24c3d9a0b1c2d3e4f5a6b7c8d9e0f1a2b3d920",
          approval: { required: 2, approved_by: [], rejected_by: null },
        }),
      );
      api.keys.test.push(
        apiKey({
          name: "Acme checkout",
          type: "restricted",
          scopes: ["payment_intents.write", "refunds.read"],
          last_used_at: NOW - 120,
        }),
        apiKey({ name: "Local development" }),
      );
      const ep = endpoint({ url: "https://acme.studio/payments/webhooks" });
      api.endpoints.test.push(ep);
      api.agentPayments.test.push(
        agentPayment({ resource_url: "https://api.acme.studio/market-data" }),
        agentPayment({ status: "failed", tx_hash: null, error_reason: "settlement_failed" }),
      );
      const shot = async (name: string) => {
        await page.waitForLoadState("networkidle");
        await page.mouse.move(1, 1);
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${DIR}/${name}-${width}.png`, fullPage: true });
      };
      await page.goto("/signin");
      await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
      await shot("00-sign-in");
      await page.goto("/signup");
      await shot("00-sign-up");
      await signIn(page, api);
      await expect(page.getByTestId("volume-chart")).toBeVisible();
      await shot("01-home");
      await page.goto("/setup");
      await shot("02-onboarding-checklist");
      await page.goto("/payments");
      await shot("03-payments");
      await page.goto(`/payments/${api.intents.test[0]?.id}`);
      await shot("04-payment-detail");
      await page.goto("/settlement");
      await shot("05-payout-wallets");
      await page.goto("/settlement/new?mode=live");
      await shot("06-add-payout-wallet-live");
      await page.goto("/developers");
      await shot("07-developers");
      await page.goto("/developers/start");
      await shot("08-start-accepting-payments");
      await page.goto(`/developers/webhooks/${ep.id}`);
      await shot("09-webhook-endpoint");
      await page.goto("/agent-payments");
      await shot("10-agent-payments");
      await page.goto("/agent-payments/new");
      await shot("11-add-paid-resource");
      await page.goto("/settings");
      await shot("12-settings");
      await page.goto("/settings/account");
      await shot("13-account-settings");
      await page.goto("/payment-links/new");
      await shot("16-create-payment-link");
      // Solana payout wallet: the attest page (signing standard, network row, message)
      await page.goto("/settlement/new?mode=live");
      await page.getByLabel("Wallet name").fill("Solana treasury");
      await page.getByLabel("Currency").selectOption("SOL");
      await page.getByRole("radio", { name: /Address on/ }).check();
      await page.getByLabel("Wallet address").fill("EyjEeiTxb4rvkoN3ZA2zTimuc6VyF8V1QuH9TT66Gkn6");
      api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
      await page.getByRole("button", { name: "Connect wallet & verify" }).click();
      await expect(page.getByTestId("solana-signer")).toBeVisible();
      await shot("21-attest-solana");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "attest page must not scroll sideways").toBeLessThanOrEqual(0);
      api.intents.test = [];
      await page.goto("/payments");
      await shot("14-first-payment-empty");
      if (width < 960) {
        await page.goto("/");
        await page.getByRole("button", { name: "Open menu" }).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${DIR}/15-mobile-drawer-${width}.png` });
      }
    });
  }
});
