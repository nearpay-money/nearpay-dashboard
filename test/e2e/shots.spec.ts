/** Review screenshots (NP_SHOTS=<dir>): every main screen at 1440 and 390 px. Skipped in normal runs. */
import { agentPayment, apiKey, destination, endpoint, intent, NOW } from "./fixtures";
import { expect, signIn, test } from "./harness";

const DIR = process.env.NP_SHOTS;

test.describe("screenshots", () => {
  test.skip(!DIR, "set NP_SHOTS to a directory to take review screenshots");
  for (const width of [1440, 390]) {
    test(`main screens at ${width}px`, async ({ page, api }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: width > 900 ? 1000 : 844 });
      const day = 86_400;
      api.intents.test.push(
        ...Array.from({ length: 9 }, (_, i) =>
          intent({
            created: NOW - i * day * 0.8 - 600,
            succeeded_at: NOW - i * day * 0.8 - 500,
            amount: 4900 + ((i * 3700) % 12000),
            description: ["Acme Pro", "Team plan", "Consultation"][i % 3] ?? "Acme Pro",
          }),
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
          status: "cooling_off",
          active_at: NOW + 18 * 3600,
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
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${DIR}/${name}-${width}.png`, fullPage: true });
      };
      await signIn(page, api);
      await expect(page.getByTestId("volume-chart")).toBeVisible();
      await shot("01-overview");
      await page.goto("/setup");
      await shot("02-onboarding-checklist");
      await page.goto("/payments");
      await shot("03-payments");
      await page.goto(`/payments/${api.intents.test[0]?.id}`);
      await shot("04-payment-detail");
      await page.goto("/settlement");
      await shot("05-settlement");
      await page.goto("/settlement/new?mode=live");
      await shot("06-add-destination-live");
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
