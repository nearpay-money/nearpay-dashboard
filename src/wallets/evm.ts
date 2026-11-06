/**
 * EVM wallets for EIP-191 attestations (identity LLD §8.2): providers discovered via EIP-6963 (with the
 * legacy `window.ethereum` as fallback), `personal_sign` over the exact challenge message. The address
 * that signs must be the destination address; nothing else is ever signed here.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface EvmWallet {
  readonly id: string;
  readonly name: string;
  readonly provider: Eip1193Provider;
}

interface AnnounceDetail {
  info?: { uuid?: string; name?: string; rdns?: string };
  provider?: Eip1193Provider;
}

/** EIP-6963 discovery; resolves after `waitMs` with every announced wallet (deduplicated). */
export function discoverEvmWallets(win: Window = window, waitMs = 250): Promise<EvmWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, EvmWallet>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<AnnounceDetail>).detail;
      if (!d?.provider || typeof d.provider.request !== "function") return;
      const id = d.info?.rdns ?? d.info?.uuid ?? `wallet-${found.size}`;
      found.set(id, { id, name: d.info?.name ?? id, provider: d.provider });
    };
    win.addEventListener("eip6963:announceProvider", onAnnounce);
    win.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      win.removeEventListener("eip6963:announceProvider", onAnnounce);
      const legacy = (win as unknown as { ethereum?: Eip1193Provider }).ethereum;
      if (found.size === 0 && legacy && typeof legacy.request === "function") {
        found.set("injected", { id: "injected", name: "Browser wallet", provider: legacy });
      }
      resolve([...found.values()]);
    }, waitMs);
  });
}

/** UTF-8 → `0x…` hex (the `personal_sign` message encoding). */
export function utf8ToHex(s: string): string {
  return `0x${[...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class WalletMismatchError extends Error {
  constructor(expected: string, got: readonly string[]) {
    super(`The wallet is connected to ${got.join(", ") || "no account"}; switch it to ${expected} and try again.`);
    this.name = "WalletMismatchError";
  }
}

/** Asks the wallet for accounts, checks `address` is among them, signs `message` with EIP-191. */
export async function signEip191(provider: Eip1193Provider, address: string, message: string): Promise<string> {
  const accounts = ((await provider.request({ method: "eth_requestAccounts" })) as unknown[])
    .filter((a): a is string => typeof a === "string")
    .map((a) => a.toLowerCase());
  const want = address.toLowerCase();
  if (!accounts.includes(want)) throw new WalletMismatchError(address, accounts);
  const sig = await provider.request({ method: "personal_sign", params: [utf8ToHex(message), want] });
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    throw new Error("The wallet returned an invalid signature.");
  }
  return sig;
}
