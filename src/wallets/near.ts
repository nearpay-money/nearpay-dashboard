/**
 * NEAR wallets for NEP-413 attestations via NEAR Connect (ADR-0010, identity LLD §8.2): the wallet signs
 * `{message, recipient, nonce}` exactly as the challenge gives them; the signing account must be the
 * destination account. NEAR Connect is loaded on demand, with the reviewed wallet list in `./near-manifest.ts`
 * (executors at full commit SHAs, checked with SRI), enforced by `./near-pinning.ts`: nothing is downloaded from a
 * mutable branch.
 */
import type { NearConnectorOptions } from "@hot-labs/near-connect";
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
  /** NEAR Connect `signAndSendTransaction` (stage 4: merchant mandate cancel). */
  signAndSendTransaction?(p: {
    signerId?: string;
    receiverId: string;
    actions: ReadonlyArray<{
      type: "FunctionCall";
      params: { methodName: string; args: object; gas: string; deposit: string };
    }>;
  }): Promise<unknown>;
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
  connector ??= Promise.all([import("@hot-labs/near-connect"), import("./near-pinning")]).then(([lib, pin]) => {
    pin.installExecutorIntegrity();
    const nonce = cspNonce();
    const c = new lib.NearConnector({
      network: NEAR_NETWORK,
      ...(nonce ? { cspNonce: nonce } : {}),
      // The library types `platform` as string[]; the manifest (and the library at runtime) use an object.
      manifest: pin.pinnedManifest() as unknown as NearConnectorOptions["manifest"],
      autoConnect: false,
      storage: pin.withoutDebugWallets(new lib.LocalStorage()),
    });
    return { connect: () => pin.connectPinnedWallet(c, lib) as unknown as Promise<NearWalletLike> };
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

/** A NEAR transaction exactly as the API returned it (spec 0.4.0 `NearTransactionRequest`). */
export interface NearTxRequest {
  readonly signer_id: string | null;
  readonly receiver_id: string;
  readonly actions: ReadonlyArray<{
    readonly type: "FunctionCall";
    readonly method_name: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly gas: string;
    readonly deposit: string;
  }>;
}

/** The transaction hash in a NEAR Connect `FinalExecutionOutcome`, if the wallet returned one. */
export function outcomeTxHash(outcome: unknown): string | undefined {
  const o = outcome as { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } } | undefined;
  const h = o?.transaction?.hash ?? o?.transaction_outcome?.id;
  return typeof h === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(h) ? h : undefined;
}

/**
 * Connects a wallet and signs + sends `tx` verbatim from `signer` (the account the API names). The
 * connected wallet must hold `signer`; receiver, methods, args, gas and deposit are passed through
 * unchanged (only renamed to NEAR Connect's camelCase). Returns the transaction hash when known.
 */
export async function signAndSendNear(
  getConnector: () => Promise<NearConnectorLike>,
  tx: NearTxRequest,
  signer: string,
): Promise<{ txHash: string | undefined }> {
  if (tx.signer_id !== null && tx.signer_id !== signer) throw new WalletMismatchError(tx.signer_id, [signer]);
  const wallet = await (await getConnector()).connect();
  const accounts = (await wallet.getAccounts()).map((a) => a.accountId);
  if (!accounts.includes(signer)) throw new WalletMismatchError(signer, accounts);
  if (!wallet.signAndSendTransaction) throw new Error("This wallet can't send NEAR transactions. Use another wallet.");
  const outcome = await wallet.signAndSendTransaction({
    signerId: signer,
    receiverId: tx.receiver_id,
    actions: tx.actions.map((a) => ({
      type: "FunctionCall" as const,
      params: { methodName: a.method_name, args: { ...a.args }, gas: a.gas, deposit: a.deposit },
    })),
  });
  return { txHash: outcomeTxHash(outcome) };
}
