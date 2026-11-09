/**
 * Solana wallets for `standard: solana` attestations (identity §20, spec 0.4.0): wallets announced via
 * the Wallet Standard (`wallet-standard:register-wallet` / `wallet-standard:app-ready` events — Phantom,
 * Solflare, Backpack) that offer `solana:signMessage`. The wallet signs the exact UTF-8 bytes of the
 * challenge (raw bytes, no off-chain message header); the signing account must be the destination
 * address. The signature is returned base58-encoded. No library and no remote script: discovery is the
 * standard's two DOM events.
 */
import { base58Encode } from "../lib/chains";
import { WalletMismatchError } from "./evm";

interface StdAccount {
  readonly address: string;
  readonly publicKey?: Uint8Array;
}

interface StdWallet {
  readonly name: string;
  readonly icon?: string;
  readonly accounts: readonly StdAccount[];
  readonly chains?: readonly string[];
  readonly features: Record<string, unknown>;
}

interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StdAccount[] }>;
}
interface SignMessageFeature {
  signMessage(
    ...inputs: { account: StdAccount; message: Uint8Array }[]
  ): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>;
}

export interface SolanaWallet {
  readonly id: string;
  readonly name: string;
  readonly wallet: StdWallet;
}

const canSign = (w: StdWallet) =>
  typeof (w.features?.["solana:signMessage"] as SignMessageFeature | undefined)?.signMessage === "function" &&
  typeof (w.features?.["standard:connect"] as ConnectFeature | undefined)?.connect === "function";

/** Wallet Standard discovery; resolves after `waitMs` with every wallet that can sign Solana messages. */
export function discoverSolanaWallets(win: Window = window, waitMs = 250): Promise<SolanaWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, SolanaWallet>();
    const register = (...wallets: StdWallet[]) => {
      for (const w of wallets) {
        if (!w || !canSign(w)) continue;
        const id = w.name;
        if (!found.has(id)) found.set(id, { id, name: w.name, wallet: w });
      }
      return () => {};
    };
    const api = Object.freeze({ register });
    const onRegister = (e: Event) => {
      const cb = (e as CustomEvent<(api: { register: typeof register }) => void>).detail;
      if (typeof cb === "function") cb(api);
    };
    win.addEventListener("wallet-standard:register-wallet", onRegister);
    try {
      win.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
    } catch {
      // a wallet's listener threw; others still registered
    }
    setTimeout(() => {
      win.removeEventListener("wallet-standard:register-wallet", onRegister);
      resolve([...found.values()]);
    }, waitMs);
  });
}

/** Connects `w`, checks it holds `address`, signs the UTF-8 bytes of `message`; returns base58. */
export async function signSolanaMessage(w: SolanaWallet, address: string, message: string): Promise<string> {
  const connect = w.wallet.features["standard:connect"] as ConnectFeature;
  const { accounts } = await connect.connect();
  const all = [...accounts, ...w.wallet.accounts];
  const account = all.find((a) => a.address === address);
  if (!account)
    throw new WalletMismatchError(
      address,
      all.map((a) => a.address),
    );
  const bytes = new TextEncoder().encode(message);
  const sign = w.wallet.features["solana:signMessage"] as SignMessageFeature;
  const [out] = await sign.signMessage({ account, message: bytes });
  if (!out) throw new Error("The wallet returned no signature.");
  // the wallet must sign exactly our bytes (no off-chain header or SIWS wrapper)
  const same = out.signedMessage.length === bytes.length && out.signedMessage.every((b, i) => b === bytes[i]);
  if (!same) throw new Error("The wallet changed the message before signing. Use a wallet that signs raw messages.");
  if (out.signature.length !== 64) throw new Error("The wallet returned an unexpected signature format.");
  return base58Encode(out.signature);
}
