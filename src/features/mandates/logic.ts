/**
 * Auto-debit logic (lld/billing.md §6, §7.1, §14; spec 0.4.0 `mandates`): eligibility of a subscription's
 * pricing, copy for statuses and unlinked reasons, period lengths, the funding summary, the collection
 * history (invoices paid by a vault collection + the mandate's last collection), and the check that a
 * prepared cancel transaction is exactly `cancel({mandate_id})` on the mandate's vault before any wallet
 * prompt (lld/dashboard §1 "wallet signing builds exactly the API payload").
 */
import type { Invoice } from "@nearpay/spec";
import { formatUnits } from "../../lib/money";
import {
  invoiceMandateCollection,
  type Mandate,
  type MandateCollection,
  type MandateFundingInstructions,
  type NearTransactionRequest,
} from "../../lib/spec-next";

// ------------------------------------------------------------------ eligibility (billing §14 d2)

export interface PricingLike {
  readonly currency: string;
  readonly asset_id?: string | null;
}
export interface DestinationLike {
  readonly type: string;
  readonly status: string;
  readonly asset_id: string;
}

export type Eligibility =
  | { readonly kind: "eligible"; readonly tokens: string; readonly note?: string }
  | { readonly kind: "check"; readonly tokens: string; readonly note: string }
  | { readonly kind: "ineligible"; readonly reason: string; readonly fix?: { label: string; to: string } };

/**
 * Whether a subscription priced like `p` can use auto-debit. USD prices are paid at par in USDC or USDT;
 * an asset price only when the vault allows that NEP-141 token (the API decides — `check`); other fiat
 * has no vault token in v1. Collections go to a NEAR Intents account, so one must be active.
 */
export function autoDebitEligibility(
  p: PricingLike | undefined,
  destinations: readonly DestinationLike[] | undefined,
  assetSymbol: (assetId: string) => string | undefined,
): Eligibility {
  if (!p) return { kind: "ineligible", reason: "Choose a recurring price first." };
  const intents = destinations?.filter((d) => d.type === "intents_account" && d.status === "active");
  const noIntents: Eligibility = {
    kind: "ineligible",
    reason:
      "Auto-debit pays collections to a NEAR Intents account, and you don't have an active one in this mode yet.",
    fix: { label: "Add a NEAR Intents account", to: "/settlement/new" },
  };
  if (p.currency === "usd") {
    if (intents && intents.length === 0) return noIntents;
    return { kind: "eligible", tokens: "USDC or USDT (1 USD = 1 token)" };
  }
  if (p.currency === "asset") {
    const id = p.asset_id ?? "";
    if (!id.startsWith("nep141:"))
      return {
        kind: "ineligible",
        reason: "The vault holds NEAR (NEP-141) tokens only, and this price uses another kind of asset.",
      };
    if (intents && intents.length === 0) return noIntents;
    const sym = assetSymbol(id) ?? id.slice(7);
    return {
      kind: "check",
      tokens: sym,
      note: `Works only if the auto-debit vault allows ${sym}. NearPay checks when you save.`,
    };
  }
  return {
    kind: "ineligible",
    reason: `${p.currency.toUpperCase()} prices can't be auto-debited: the vault holds USDC and USDT, which track USD. Use USD prices for auto-debit, or keep emailed invoices.`,
  };
}

// ------------------------------------------------------------------ copy

export const UNLINKED_REASON: Readonly<Record<string, string>> = {
  subscription_not_auto_debit: "The subscription doesn't use auto-debit, so this mandate isn't collected.",
  subscription_ended: "The subscription had already ended when the customer funded this mandate.",
  already_linked: "The subscription already has an active mandate; only one is collected.",
  receiver_kind_mismatch: "The mandate pays a plain NEAR account instead of your NEAR Intents account.",
  receiver_not_destination: "The mandate pays an account that isn't one of your active NEAR Intents destinations.",
  token_mismatch: "The mandate holds a different token than the one prepared for this subscription.",
  amount_mismatch: "The amount per period differs from the subscription's per-period total.",
  period_mismatch: "The period length differs from the subscription's billing interval.",
  fee_mismatch: "The NearPay fee on the mandate differs from your agreed fee.",
  start_too_late: "The first collection date is after the subscription's current period ends.",
  max_periods_too_low: "The mandate allows fewer periods than the subscription still needs.",
  mode_mismatch: "A test-mode mandate can't pay a live subscription, and the other way round.",
};

export function unlinkedReasonText(reason: string | null): string {
  if (!reason) return "Its terms don't match what NearPay prepared for the subscription.";
  return UNLINKED_REASON[reason] ?? `Reason: ${reason.replace(/_/g, " ")}.`;
}

/** Status label shown for a mandate: an unlinked active mandate reads "Unlinked" (it is never collected). */
export function mandateStatusValue(m: Pick<Mandate, "status" | "link_status">): string {
  if (m.link_status === "unlinked" && (m.status === "active" || m.status === "insufficient")) return "unlinked";
  return m.status;
}

const MONTH = 2_629_746;
const YEAR = 31_556_952;

/** `2629746` → `"month"`, `1209600` → `"2 weeks"`; other lengths in days/hours. */
export function periodText(secs: number): string {
  const unit = (n: number, one: string) => (n === 1 ? one : `${n} ${one}s`);
  if (secs % YEAR === 0) return unit(secs / YEAR, "year");
  if (secs % MONTH === 0) return unit(secs / MONTH, "month");
  if (secs % 604_800 === 0) return unit(secs / 604_800, "week");
  if (secs % 86_400 === 0) return unit(secs / 86_400, "day");
  return `${Math.round(secs / 3600)} hours`;
}

/** Token amount in base units → "12.5 USDC" (exact; unknown token → base units with its id). */
export function tokenAmount(amount: string, symbol: string | undefined, decimals: number | undefined): string {
  if (symbol === undefined || decimals === undefined) return `${amount} base units`;
  return `${formatUnits(amount, decimals)} ${symbol}`;
}

/** `fee_bps` → "1.25%". */
export function bpsText(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}%`;
}

/** Expected merchant share of one period (vault §3.2): `floor(amount × (10000 − fee_bps) / 10000)`. */
export function expectedShare(amount: string, feeBps: number): bigint {
  return (BigInt(amount) * BigInt(10_000 - feeBps)) / 10_000n;
}

/** Whether the merchant may still cancel on chain (the vault's active state). */
export const isOnchainActive = (m: Pick<Mandate, "status">) => m.status === "active" || m.status === "insufficient";

/** 64-hex implicit accounts are NEAR keys; `0x…` Intents accounts are EVM-keyed and can't sign NEAR transactions. */
export const isEvmKeyedAccount = (account: string) => /^0x[0-9a-fA-F]{40}$/.test(account);

// ------------------------------------------------------------------ collections

export interface CollectionRow {
  readonly key: string;
  readonly period: number;
  readonly invoice: string | null;
  readonly merchant_share: string;
  readonly fee: string;
  readonly short: boolean;
  readonly tx_hash: string;
  readonly receipt_id: string;
  readonly collected_at: number | null;
}

/**
 * Collection history: the subscription's invoices paid by this mandate (`Invoice.mandate_collection`,
 * the evidence on each paid invoice), plus the mandate's `last_collection` when no invoice shows it
 * (a short collection does not mark the invoice paid). Newest period first.
 */
export function collectionRows(
  m: Pick<Mandate, "id" | "last_collection">,
  invoices: readonly Invoice[],
): CollectionRow[] {
  const rows = new Map<number, CollectionRow>();
  for (const inv of invoices) {
    const c = invoiceMandateCollection(inv);
    if (!c || c.mandate !== m.id) continue;
    rows.set(c.period, {
      key: `${inv.id}:${c.period}`,
      period: c.period,
      invoice: inv.id,
      merchant_share: c.merchant_share,
      fee: c.fee,
      short: false,
      tx_hash: c.tx_hash,
      receipt_id: c.receipt_id,
      collected_at: inv.status_transitions.paid_at,
    });
  }
  const last: MandateCollection | null = m.last_collection;
  if (last) {
    const prev = rows.get(last.period);
    rows.set(last.period, {
      key: prev?.key ?? `last:${last.period}`,
      period: last.period,
      invoice: last.invoice ?? prev?.invoice ?? null,
      merchant_share: last.merchant_share,
      fee: last.fee,
      short: last.short,
      tx_hash: last.tx_hash,
      receipt_id: last.receipt_id,
      collected_at: last.collected_at,
    });
  }
  return [...rows.values()].sort((a, b) => b.period - a.period);
}

// ------------------------------------------------------------------ transactions

export interface TxSummaryLine {
  readonly receiver: string;
  readonly method: string;
  readonly args: string;
  readonly gas: string;
  readonly deposit: string;
}

/** Gas units → "100 Tgas"; yoctoNEAR → "0.012 NEAR" / "1 yoctoNEAR" (exact). */
export function gasText(gas: string): string {
  return `${formatUnits(gas, 12)} Tgas`;
}
export function yoctoText(yocto: string): string {
  if (yocto === "1") return "1 yoctoNEAR";
  if (yocto === "0") return "none";
  return `${formatUnits(yocto, 24)} NEAR`;
}

export function txLines(tx: NearTransactionRequest): TxSummaryLine[] {
  return tx.actions.map((a) => ({
    receiver: tx.receiver_id,
    method: a.method_name,
    args: JSON.stringify(a.args),
    gas: gasText(a.gas),
    deposit: yoctoText(a.deposit),
  }));
}

/**
 * The prepared cancel must be one `cancel({mandate_id})` call on the mandate's vault, signed by the
 * merchant receiver, 1 yoctoNEAR attached; otherwise the dashboard refuses to open a wallet.
 */
export function checkCancelTx(
  m: Pick<Mandate, "vault_contract" | "onchain_id" | "merchant_receiver">,
  tx: NearTransactionRequest,
): string | null {
  const a = tx.actions[0];
  if (tx.actions.length !== 1 || !a) return "The cancel transaction has unexpected actions.";
  if (tx.receiver_id !== m.vault_contract) return "The cancel transaction doesn't call this mandate's vault.";
  if (tx.signer_id !== null && tx.signer_id !== m.merchant_receiver)
    return "The cancel transaction names a different signer than your receiving account.";
  if (a.method_name !== "cancel") return "The transaction isn't a cancel.";
  const keys = Object.keys(a.args);
  if (keys.length !== 1 || a.args.mandate_id !== m.onchain_id)
    return "The cancel transaction names a different mandate.";
  if (a.deposit !== "1") return "The cancel transaction attaches an unexpected deposit.";
  return null;
}

/** near-cli-rs command that sends exactly the prepared transaction (manual path). */
export function nearCliCommand(tx: NearTransactionRequest, signer: string, network = "mainnet"): string {
  return tx.actions
    .map(
      (a) =>
        `near contract call-function as-transaction ${tx.receiver_id} ${a.method_name} json-args '${JSON.stringify(a.args)}' prepaid-gas '${formatUnits(a.gas, 12)} Tgas' attached-deposit '${a.deposit === "1" ? "1 yoctoNEAR" : `${formatUnits(a.deposit, 24)} NEAR`}' sign-as ${signer} network-config ${network} sign-with-keychain send`,
    )
    .join("\n");
}

/** Plain-text funding instructions for the customer (copied by the merchant). */
export function fundingInstructionsText(
  f: MandateFundingInstructions,
  o: { merchant: string; symbol: string | undefined; decimals: number | undefined; invoiceUrl?: string | null },
): string {
  const amt = (v: string) => tokenAmount(v, o.symbol, o.decimals);
  const lines = [
    `Set up auto-debit for your ${o.merchant} subscription`,
    "",
    `You fund a mandate in the NearPay subscription vault (${f.vault_contract}) with ${amt(f.amount)} (${f.periods} × ${amt(f.amount_per_period)}).`,
    `${o.merchant} can collect at most ${amt(f.amount_per_period)} every ${periodText(f.period_secs)}. You can cancel at any time and get the remaining balance back.`,
    "",
    f.payer_notice,
    "",
    ...(o.invoiceUrl ? [`Easiest: open your invoice and choose "Set up auto-debit": ${o.invoiceUrl}`, ""] : []),
    "Transactions to sign, in order, from your own NEAR account:",
    ...f.transactions.flatMap((t, i) =>
      t.actions.map(
        (a) =>
          `${i + 1}. ${t.receiver_id} → ${a.method_name}(${JSON.stringify(a.args)}) · gas ${gasText(a.gas)} · deposit ${yoctoText(a.deposit)}`,
      ),
    ),
  ];
  return lines.join("\n");
}

/**
 * Display guard for prepared funding: the last transaction must be `ft_transfer_call` on the token with
 * `receiver_id` = the vault, `amount` and `msg` exactly as the instructions state; an optional first one
 * `storage_deposit` on the vault. Anything else is not shown to the merchant for sharing.
 */
export function checkFundingTx(f: MandateFundingInstructions): string | null {
  const txs = f.transactions;
  const last = txs[txs.length - 1];
  const call = last?.actions[0];
  if (!last || !call || last.actions.length !== 1) return "The funding instructions are incomplete.";
  if (last.receiver_id !== f.token || call.method_name !== "ft_transfer_call")
    return "The funding transaction doesn't transfer the subscription's token.";
  const a = call.args as { receiver_id?: unknown; amount?: unknown; msg?: unknown };
  if (a.receiver_id !== f.vault_contract || a.amount !== f.amount || a.msg !== f.msg)
    return "The funding transaction doesn't match the stated vault, amount or terms.";
  if (call.deposit !== "1") return "The funding transaction attaches an unexpected deposit.";
  if (txs.length === 2) {
    const s = txs[0];
    if (!s || s.receiver_id !== f.vault_contract || s.actions.some((x) => x.method_name !== "storage_deposit"))
      return "The storage transaction doesn't go to the vault.";
  }
  return null;
}

/** `start_at` in ns (string) → unix seconds, or null (block time = right away). */
export function startAtSeconds(ns: string | null): number | null {
  return ns === null ? null : Number(BigInt(ns) / 1_000_000_000n);
}
