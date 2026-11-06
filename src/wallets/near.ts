/**
 * NEAR wallets for NEP-413 attestations via NEAR Connect (ADR-0010, identity LLD §8.2): the wallet signs
 * `{message, recipient, nonce}` exactly as the challenge gives them; the signing account must be the
 * destination account. NEAR Connect is loaded on demand.
 */
import { cspNonce, NEAR_NETWORK } from "../lib/config";
import { WalletMismatchError } from "./evm";

export interface NearSignedMessage {
  readonly accountId: string;
  readonly publicKey: string;
  readonly signature: string;
}

export interface NearWalletLike {
  getAccounts(data?: unknown): Promise<ReadonlyArray<{ accountId: string }>>;
  signMessage(p: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
    signerId?: string;
  }): Promise<NearSignedMessage>;
}

export interface NearConnectorLike {
  connect(): Promise<NearWalletLike>;
}

/** Base64 NEP-413 nonce → 32 bytes. */
export function nonceBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (out.length !== 32) throw new Error("The challenge nonce must be 32 bytes.");
  return out;
}

let connector: Promise<NearConnectorLike> | null = null;

/** The shared NEAR Connect instance (lazy). */
export function nearConnector(): Promise<NearConnectorLike> {
  connector ??= import("@hot-labs/near-connect").then(({ NearConnector }) => {
    const nonce = cspNonce();
    const c = new NearConnector({ network: NEAR_NETWORK, ...(nonce ? { cspNonce: nonce } : {}) });
    return { connect: () => c.connect() as unknown as Promise<NearWalletLike> };
  });
  return connector;
}

/** Connects a wallet and signs the challenge with the destination account. */
export async function signNep413(
  getConnector: () => Promise<NearConnectorLike>,
  c: { message: string; recipient: string; nonce: string; address: string },
): Promise<NearSignedMessage> {
  const wallet = await (await getConnector()).connect();
  const accounts = (await wallet.getAccounts()).map((a) => a.accountId);
  if (!accounts.includes(c.address)) throw new WalletMismatchError(c.address, accounts);
  const signed = await wallet.signMessage({
    message: c.message,
    recipient: c.recipient,
    nonce: nonceBytes(c.nonce),
    signerId: c.address,
  });
  if (signed.accountId !== c.address) throw new WalletMismatchError(c.address, [signed.accountId]);
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(signed.publicKey)) {
    throw new Error("The wallet returned an unexpected public key format.");
  }
  return signed;
}
