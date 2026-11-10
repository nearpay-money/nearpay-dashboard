/**
 * Stage 4 Solana / Bitcoin settlement destinations (identity §20, spec 0.4.0): live
 * Solana destination verified with a Wallet Standard wallet signing the raw challenge (ed25519, checked by
 * the mock), Bitcoin address types (P2WPKH/P2TR only, explained), lower-case normalisation, BIP-322
 * "simple" signature pasted as base64 (shape-checked before sending), program-derived Solana addresses
 * refused in live mode. CSP guard via the harness.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { BTC_BITCOIN, SOL_SOLANA } from "../../../test/e2e/fixtures";
import { expect, signIn, test } from "../../../test/e2e/harness";

const require = createRequire(import.meta.url);
const SHOTS = process.env.NP_SHOTS ?? "/home/claude/shots/dashboard-4.3";
mkdirSync(SHOTS, { recursive: true });
test.use({ viewport: { width: 1440, height: 900 } });

async function shots(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/${name}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** A Wallet Standard Solana wallet in the page whose key stays in Node (signing via an exposed function). */
async function solanaWallet(page: Page) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const address = b58(Uint8Array.from(publicKey.export({ format: "der", type: "spki" }).subarray(12)));
  await page.exposeFunction("__npSolSign", (msgB64: string) =>
    Buffer.from(sign(null, Buffer.from(msgB64, "base64"), privateKey)).toString("base64"),
  );
  await page.addInitScript((addr: string) => {
    const w = window as unknown as Record<string, unknown>;
    const account = { address: addr, publicKey: new Uint8Array(32) };
    const wallet = {
      name: "Test Solana Wallet",
      version: "1.0.0",
      icon: "",
      chains: ["solana:mainnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async (input: { account: unknown; message: Uint8Array }) => {
            w.__solSigned = new TextDecoder().decode(input.message);
            const b64 = btoa(String.fromCharCode(...input.message));
            const sig = await (w.__npSolSign as (m: string) => Promise<string>)(b64);
            return [{ signedMessage: input.message, signature: Uint8Array.from(atob(sig), (c) => c.charCodeAt(0)) }];
          },
        },
      },
    };
    const cb = (api: { register(...ws: unknown[]): void }) => api.register(wallet);
    window.addEventListener("wallet-standard:app-ready", (e) => cb((e as CustomEvent).detail));
    try {
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb }));
    } catch {
      // no listener yet
    }
  }, address);
  return address;
}

async function newDestination(page: Page, symbol: string, address: string, label: string) {
  await page.getByLabel("Wallet name").fill(label);
  await page.getByLabel("Currency").selectOption(symbol);
  await page.getByRole("radio", { name: /Address on/ }).check();
  await page.getByLabel("Wallet address").fill(address);
}

test("live Solana destination: raw-message signature from a Wallet Standard wallet", async ({ page, api }) => {
  const address = await solanaWallet(page);
  await signIn(page, api, "/settlement/new?mode=live");
  await newDestination(page, "SOL", address, "Solana treasury");
  await expect(page.getByLabel("Network", { exact: true })).toHaveValue(SOL_SOLANA);
  await expect(page.getByTestId("verify-howto")).toContainText("Phantom, Solflare or Backpack");
  api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
  await page.getByRole("button", { name: "Connect wallet & verify" }).click();
  const message = await page.getByTestId("challenge-message").textContent();
  await expect(page.getByTestId("solana-signer")).toBeVisible();
  await shots(page, "destination-solana-attest");
  await page.getByRole("button", { name: "Connect Solana wallet" }).click();
  const wallet = page.getByRole("menuitem", { name: /Test Solana Wallet/ });
  await expect(wallet).toBeFocused();
  await shots(page, "destination-solana-picker");
  await wallet.click();
  await expect(page.getByText("Signature verified.")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __solSigned: string }).__solSigned)).toBe(message);
  const body = api.callsTo("attestSettlementDestination")[0]?.body as { standard: string; signature: string };
  expect(body.standard).toBe("solana");
  expect(body.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
});

test("live Solana: a base64 paste is refused before sending; program-derived addresses can't be added", async ({
  page,
  api,
}) => {
  await signIn(page, api, "/settlement/new?mode=live");
  await newDestination(page, "SOL", "DN5C7q7RzxDXor5jNHDBxfHU5yp3M58XJXcWR4WvvyAp", "PDA");
  await page.getByRole("button", { name: "Connect wallet & verify" }).click();
  await expect(page.getByText(/program-derived address/)).toBeVisible();
  expect(api.callsTo("createSettlementDestination")).toHaveLength(0);
  await page.getByLabel("Wallet address").fill("EyjEeiTxb4rvkoN3ZA2zTimuc6VyF8V1QuH9TT66Gkn6");
  api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
  await page.getByRole("button", { name: "Connect wallet & verify" }).click();
  // no Solana wallet in this browser: the empty state is inside the menu, with the paste fallback
  await page.getByRole("button", { name: "Connect Solana wallet" }).click();
  await expect(page.getByTestId("wallet-picker-empty")).toContainText("No wallet found in this browser");
  await expect(page.getByRole("menuitem", { name: "Search again" })).toBeFocused();
  await shots(page, "destination-solana-picker-empty");
  await page.getByRole("menuitem", { name: "Paste a signature instead" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByTestId("solana-signature")).toBeFocused();
  await page.getByTestId("solana-signature").fill(Buffer.alloc(64, 7).toString("base64"));
  await page.getByRole("button", { name: "Verify signature" }).click();
  await expect(page.getByText(/Paste the signature in base58/)).toBeVisible();
  expect(api.callsTo("attestSettlementDestination")).toHaveLength(0);
});

test("live Bitcoin destination: P2WPKH/P2TR only, lower-cased, BIP-322 simple pasted as base64", async ({
  page,
  api,
}) => {
  const vec = JSON.parse(
    readFileSync(require.resolve("@nearpay/spec/test-vectors/destination-attestation.json"), "utf8"),
  ) as {
    bip322: { nearpay: { type: string; cases: { signature: string; valid: boolean; name: string }[] }[] };
  };
  const p2wpkh = vec.bip322.nearpay.find((v) => v.type === "p2wpkh");
  const valid = p2wpkh?.cases.find((c) => c.valid)?.signature ?? "";
  const full = p2wpkh?.cases.find((c) => c.name.includes('"full"'))?.signature ?? "";
  await signIn(page, api, "/settlement/new?mode=live");
  await newDestination(page, "BTC", "3EdC2tokZbqft8jYFdvN58YaCetzMUBRji", "Cold storage");
  await expect(page.getByLabel("Network", { exact: true })).toHaveValue(BTC_BITCOIN);
  await page.getByRole("button", { name: "Connect wallet & verify" }).click();
  await expect(page.getByText(/P2SH \(3…\) addresses, including nested SegWit, can't prove ownership/)).toBeVisible();
  expect(api.callsTo("createSettlementDestination")).toHaveLength(0);
  await shots(page, "destination-bitcoin-refused");
  await page.getByLabel("Wallet address").fill("BC1QPCT5SXZPPV204TTH290UEN85NQKHZW9SQ5M0KU");
  await expect(page.getByTestId("address-note")).toContainText("bc1qpct5sxzppv204tth290uen85nqkhzw9sq5m0ku");
  api.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
  await page.getByRole("button", { name: "Connect wallet & verify" }).click();
  await expect(page.getByTestId("bitcoin-signer")).toContainText("Sparrow");
  expect((api.callsTo("createSettlementDestination")[0]?.body as { address?: string } | undefined)?.address).toBe(
    "bc1qpct5sxzppv204tth290uen85nqkhzw9sq5m0ku",
  );
  await page.getByTestId("bip322-signature").fill(full);
  await page.getByRole("button", { name: "Verify signature" }).click();
  await expect(page.getByText(/doesn't look like a BIP-322 "simple" signature/)).toBeVisible();
  expect(api.callsTo("attestSettlementDestination")).toHaveLength(0);
  await shots(page, "destination-bitcoin-attest");
  await page.getByTestId("bip322-signature").fill(valid);
  await page.getByRole("button", { name: "Verify signature" }).click();
  await expect(page.getByText("Signature verified.")).toBeVisible();
  const body = api.callsTo("attestSettlementDestination")[0]?.body as { standard: string; signature: string };
  expect(body).toMatchObject({ standard: "bip322", signature: valid });
});
