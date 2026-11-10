/**
 * Bitcoin wallets for `standard: bip322` attestations (identity §20, spec 0.4.0). Injected providers that
 * sign BIP-322 "simple" directly are offered as buttons: UniSat (`window.unisat.signMessage(msg,
 * "bip322-simple")`) and OKX (`window.okxwallet.bitcoin.signMessage(msg, "bip322-simple")`). Every other
 * wallet (Sparrow, Xverse, Leather, Bitcoin Core-compatible tools) uses the paste path: the merchant
 * signs the exact message and pastes the base64 signature. The connected address must be the destination.
 */
import { WalletMismatchError } from "./evm";

interface BtcProvider {
  requestAccounts(): Promise<string[]>;
  signMessage(message: string, type: "bip322-simple"): Promise<string>;
}

export interface BitcoinWallet {
  readonly id: "unisat" | "okx";
  readonly name: string;
  readonly provider: BtcProvider;
}

const usable = (p: unknown): p is BtcProvider =>
  !!p &&
  typeof (p as BtcProvider).requestAccounts === "function" &&
  typeof (p as BtcProvider).signMessage === "function";

/** Injected BIP-322-capable wallets present in this browser. */
export function detectBitcoinWallets(win: Window = window): BitcoinWallet[] {
  const w = win as unknown as { unisat?: unknown; okxwallet?: { bitcoin?: unknown } };
  const out: BitcoinWallet[] = [];
  if (usable(w.unisat)) out.push({ id: "unisat", name: "UniSat", provider: w.unisat });
  if (usable(w.okxwallet?.bitcoin)) out.push({ id: "okx", name: "OKX Wallet", provider: w.okxwallet.bitcoin });
  return out;
}

/**
 * Asks for accounts, checks the destination address is connected, signs BIP-322 simple; returns base64.
 * `onSigning` (UI progress only) is called once the account check passed, right before the signature request.
 */
export async function signBip322(
  w: BitcoinWallet,
  address: string,
  message: string,
  onSigning?: () => void,
): Promise<string> {
  const accounts = (await w.provider.requestAccounts()).map((a) => a.toLowerCase());
  if (!accounts.includes(address.toLowerCase())) throw new WalletMismatchError(address, accounts);
  onSigning?.();
  const sig = await w.provider.signMessage(message, "bip322-simple");
  if (typeof sig !== "string" || !sig) throw new Error("The wallet returned no signature.");
  return sig.trim();
}
