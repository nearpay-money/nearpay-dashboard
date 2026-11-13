/**
 * Address normalisation for "Add a payout wallet" before the request is built.
 *
 * A NEAR Intents account can be a `0x` account (an EVM-style account id). NEAR account ids are lower case,
 * but wallets show `0x` addresses in mixed case (EIP-55 checksum form), and the API refuses that form with
 * `address_invalid`. For the `intents_account` type only, a value that is exactly `0x` + 40 hex characters is
 * sent in lower case, and the form shows the value that will be saved.
 *
 * Nothing else is changed: not the "Address on <network>" type (`chain_address`), and no value that is not
 * `0x` + 40 hex (NEAR names, 64-hex implicit accounts, Solana and Bitcoin addresses are case-sensitive or
 * have their own checks in `lib/chains.ts`).
 */

export type DestinationType = "intents_account" | "chain_address";

const EVM_STYLE_ACCOUNT = /^0x[0-9a-fA-F]{40}$/;

export interface NormalizedAddress {
  /** The trimmed value to send. */
  readonly value: string;
  /** True when letters were lower-cased (so the form can show what will be saved). */
  readonly lowered: boolean;
}

/** Trims the input; lower-cases a `0x` + 40 hex NEAR Intents account. Everything else is left as typed. */
export function normalizeDestinationAddress(type: DestinationType, address: string): NormalizedAddress {
  const value = address.trim();
  if (type !== "intents_account" || !EVM_STYLE_ACCOUNT.test(value)) return { value, lowered: false };
  const lower = value.toLowerCase();
  return { value: lower, lowered: lower !== value };
}
