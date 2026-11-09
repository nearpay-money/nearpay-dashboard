/** Shared E2E setup: mock API, a WebAuthn virtual authenticator (CDP), injected test wallets. */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { MockApi } from "./mock-api";

export const EVM_ADDRESS = "0x52908400098527886e0f7030069857d2e4169ee7";
export const NEAR_ACCOUNT = "acme.near";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  // an existing discoverable passkey for localhost, so sign-in works without registering first
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" });
  await cdp.send("WebAuthn.addCredential", {
    authenticatorId,
    credential: {
      credentialId: randomBytes(16).toString("base64"),
      isResidentCredential: true,
      rpId: "localhost",
      privateKey: Buffer.from(key).toString("base64"),
      userHandle: randomBytes(16).toString("base64"),
      signCount: 1,
    },
  });
}

/** EIP-6963 test wallet + NEAR Connect injected test wallet; signing requests are recorded on window. */
async function injectWallets(page: Page) {
  await page.addInitScript(
    ({ evm, near }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__evmCalls = [];
      w.__nearCalls = [];
      const provider = {
        request: async (a: { method: string; params?: unknown[] }) => {
          (w.__evmCalls as unknown[]).push(a);
          if (a.method === "eth_requestAccounts" || a.method === "eth_accounts") return [evm];
          if (a.method === "personal_sign") return `0x${"1b".repeat(65)}`;
          throw new Error(`unsupported ${a.method}`);
        },
      };
      window.addEventListener("eip6963:requestProvider", () => {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: { uuid: "test-evm", name: "Test EVM Wallet", rdns: "money.nearpay.test", icon: "" },
              provider,
            },
          }),
        );
      });
      const nearWallet = {
        manifest: {
          id: "test-near-wallet",
          name: "Test NEAR Wallet",
          icon: "",
          website: "https://wallet.test",
          description: "test",
          version: "1.0.0",
          type: "injected",
          platform: {},
          permissions: {},
          features: {
            signMessage: true,
            signTransaction: true,
            signAndSendTransaction: true,
            signAndSendTransactions: true,
            signInWithoutAddKey: true,
            mainnet: true,
            testnet: true,
          },
        },
        signIn: async () => [{ accountId: near, publicKey: "ed25519:2SBdAzviwkHZ4YkAdGqXTitBPqw752YyNhYtzBQiBb25" }],
        signInAndSignMessage: async () => [],
        signOut: async () => {},
        getAccounts: async () => [
          { accountId: near, publicKey: "ed25519:2SBdAzviwkHZ4YkAdGqXTitBPqw752YyNhYtzBQiBb25" },
        ],
        signMessage: async (p: { message: string; recipient: string; nonce: Uint8Array }) => {
          (w.__nearCalls as unknown[]).push({
            message: p.message,
            recipient: p.recipient,
            nonce: btoa(String.fromCharCode(...p.nonce)),
          });
          return {
            accountId: near,
            publicKey: "ed25519:2SBdAzviwkHZ4YkAdGqXTitBPqw752YyNhYtzBQiBb25",
            signature: btoa("x".repeat(64)),
          };
        },
        signAndSendTransaction: async (p: unknown) => {
          w.__nearTxs = [...((w.__nearTxs as unknown[] | undefined) ?? []), p];
          return { transaction: { hash: "8hQ3XpDzWkYB6zEXfDzX9v2u8v5nJxQ3r7tKXk1n2bcd" } };
        },
        signAndSendTransactions: async () => [],
        signDelegateActions: async () => ({}),
      };
      window.addEventListener("near-selector-ready", () => {
        window.dispatchEvent(new CustomEvent("near-wallet-injected", { detail: nearWallet }));
      });
    },
    { evm: EVM_ADDRESS, near: NEAR_ACCOUNT },
  );
}

export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, use) => {
    const api = new MockApi();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text());
    });
    await api.install(page);
    await virtualAuthenticator(page);
    await injectWallets(page);
    await use(api);
    expect(api.unexpected, "routes the mock does not implement").toEqual([]);
    expect(errors, "page errors / CSP violations").toEqual([]);
  },
});

/** Signs in with the virtual passkey through the UI. */
export async function signIn(page: Page, api: MockApi, path = "/") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/signin/);
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page.getByTestId("account-name")).toHaveText(api.account.display_name);
}

export { expect };
