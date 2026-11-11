/**
 * Wallet signing of a refund's `next_action` (lld/dashboard-and-console.md §1, lld/payments.md §17.3):
 *
 * - `sign_intent`: the wallet signs the API's payload **verbatim** — NEP-413 `signMessage` with the
 *   exact `nep413` arguments (NEAR wallets) or ERC-191 `personal_sign` of the exact `payload` string
 *   (0x Intents accounts). The result is wrapped into a `MultiPayload` without touching the payload;
 *   payments rejects anything else (`signed_intent_mismatch`).
 * - `sign_and_send` on an EVM chain: one transfer of exactly `amount` of the token to `to`, sent from
 *   `from` (the settlement destination). Other chains use the manual path (send, then report the hash).
 *
 * The shared wallet modules (`src/wallets/*`) are used read-only for discovery and message signing.
 */
import type { MultiPayload } from "@nearpay-money/spec";
import type { Eip1193Provider } from "../../wallets/evm";
import { WalletMismatchError } from "../../wallets/evm";
import type { SignAndSend, SignIntent } from "./logic";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Bitcoin-alphabet base58 (the encoding of `CurveSignature`). */
export function base58(bytes: Uint8Array): string {
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

function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("The wallet returned an unexpected signature.");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function fromBase64(s: string): Uint8Array {
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("The wallet returned an unexpected signature.");
  }
}

/** NEAR wallet `signMessage` result → `Nep413MultiPayload` with the action's NEP-413 arguments as given. */
export function nep413MultiPayload(
  a: SignIntent,
  signed: { readonly accountId: string; readonly publicKey: string; readonly signature: string },
): MultiPayload {
  if (signed.accountId !== a.signer_id) throw new WalletMismatchError(a.signer_id, [signed.accountId]);
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(signed.publicKey))
    throw new Error("The wallet returned an unexpected key.");
  const sig = signed.signature.startsWith("ed25519:")
    ? base58Decode(signed.signature.slice(8))
    : fromBase64(signed.signature);
  if (sig.length !== 64) throw new Error("The wallet returned an unexpected signature.");
  return {
    standard: "nep413",
    payload: { recipient: a.nep413.recipient, nonce: a.nep413.nonce, message: a.nep413.message },
    public_key: signed.publicKey,
    signature: `ed25519:${base58(sig)}`,
  };
}

/** `personal_sign` hex (r‖s‖v, v ∈ {0,1,27,28}) → `Erc191MultiPayload` over the exact payload string. */
export function erc191MultiPayload(a: SignIntent, sigHex: string): MultiPayload {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sigHex)) throw new Error("The wallet returned an unexpected signature.");
  const bytes = Uint8Array.from(sigHex.slice(2).match(/../g) ?? [], (h) => Number.parseInt(h, 16));
  const v = bytes[64] as number;
  if (v === 27 || v === 28) bytes[64] = v - 27;
  else if (v !== 0 && v !== 1) throw new Error("The wallet returned an unexpected signature.");
  return { standard: "erc191", payload: a.payload, signature: `secp256k1:${base58(bytes)}` };
}

// ---------------------------------------------------------------------------------------------
// EVM transfer (sign_and_send)
// ---------------------------------------------------------------------------------------------

export interface EvmTxRequest {
  readonly chainIdHex: string;
  readonly tx: { from: string; to: string; value: string; data?: string };
}

const hex = (v: bigint) => `0x${v.toString(16)}`;
const word = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/** Whether the dashboard can send this action from a browser wallet (else: manual path). */
export function walletSendSupported(a: SignAndSend): boolean {
  return evmTransfer(a) !== null;
}

/**
 * The exact EVM transaction for a `sign_and_send` action, or null when the chain/token cannot be sent
 * from an EIP-1193 wallet here (non-EVM chain, memo required, unknown token standard).
 */
export function evmTransfer(a: SignAndSend): EvmTxRequest | null {
  const m = /^eip155:(\d{1,12})$/.exec(a.chain);
  if (!m || a.memo) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.from) || !/^0x[0-9a-fA-F]{40}$/.test(a.to)) return null;
  const amount = BigInt(a.amount);
  if (amount <= 0n) return null;
  const chainIdHex = hex(BigInt(m[1] as string));
  const from = a.from.toLowerCase();
  if (a.token.standard === "native" && a.token.address === null) {
    return { chainIdHex, tx: { from, to: a.to.toLowerCase(), value: hex(amount) } };
  }
  if (a.token.standard === "erc20" && a.token.address && /^0x[0-9a-fA-F]{40}$/.test(a.token.address)) {
    // transfer(address,uint256)
    const data = `0xa9059cbb${word(a.to)}${word(amount.toString(16))}`;
    return { chainIdHex, tx: { from, to: a.token.address.toLowerCase(), value: "0x0", data } };
  }
  return null;
}

/** Sends the transfer from `from` (checked against the wallet's accounts and chain). Returns the tx hash. */
export async function sendEvmTransfer(provider: Eip1193Provider, a: SignAndSend): Promise<string> {
  const req = evmTransfer(a);
  if (!req) throw new Error("This return cannot be sent from a browser wallet. Use “Send it yourself”.");
  const accounts = ((await provider.request({ method: "eth_requestAccounts" })) as unknown[])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase());
  if (!accounts.includes(req.tx.from)) throw new WalletMismatchError(a.from, accounts);
  const chain = await provider.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || BigInt(chain) !== BigInt(req.chainIdHex)) {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: req.chainIdHex }] });
    const now = await provider.request({ method: "eth_chainId" });
    if (typeof now !== "string" || BigInt(now) !== BigInt(req.chainIdHex))
      throw new Error("Switch your wallet to the refund's network and try again.");
  }
  const hash = await provider.request({ method: "eth_sendTransaction", params: [req.tx] });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error("The wallet did not return a transaction hash.");
  return hash;
}
