/**
 * Customer logic (lld/payments.md §17, spec `customers`): display names, form validation, wallet rows,
 * and paid totals computed from the customer's succeeded payments (integer money per currency; INV-5).
 */

import { formatMoney } from "@nearpay-internal/ui";
import type { Customer, PaymentIntent } from "@nearpay-money/spec";
import { currencyDigits } from "../../lib/money";

export const customerName = (c: Pick<Customer, "name" | "email">): string => c.name ?? c.email ?? "Unnamed customer";

export const CHAINS = [
  { value: "near:mainnet", label: "NEAR" },
  { value: "eip155:1", label: "Ethereum" },
  { value: "eip155:8453", label: "Base" },
  { value: "eip155:42161", label: "Arbitrum" },
  { value: "eip155:10", label: "Optimism" },
  { value: "eip155:137", label: "Polygon" },
  { value: "eip155:56", label: "BNB Chain" },
  { value: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", label: "Solana" },
] as const;

export const chainName = (chain: string): string => CHAINS.find((c) => c.value === chain)?.label ?? chain;

export interface WalletRow {
  readonly key: string;
  readonly chain: string;
  readonly address: string;
}

export interface CustomerForm {
  readonly name: string;
  readonly email: string;
  readonly description: string;
  readonly wallets: readonly WalletRow[];
}

export type FormErrors = Partial<Record<"name" | "email" | "description" | "wallets", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADDRESS = /^[\x21-\x7e]{2,128}$/;

export function validateCustomer(f: CustomerForm): FormErrors {
  const e: FormErrors = {};
  if (f.name.trim().length > 200) e.name = "Use at most 200 characters.";
  if (f.email.trim() && (!EMAIL.test(f.email.trim()) || f.email.trim().length > 254))
    e.email = "Enter a valid email address.";
  if (f.description.length > 500) e.description = "Use at most 500 characters.";
  if (!f.name.trim() && !f.email.trim() && f.wallets.length === 0)
    e.name = "Add at least a name, an email or a wallet.";
  if (f.wallets.length > 20) e.wallets = "Add at most 20 wallets.";
  else if (f.wallets.some((w) => !ADDRESS.test(w.address.trim()))) e.wallets = "Enter each wallet address in full.";
  return e;
}

/** Create body: empty fields are omitted. */
export function createBody(f: CustomerForm) {
  return {
    ...(f.name.trim() ? { name: f.name.trim() } : {}),
    ...(f.email.trim() ? { email: f.email.trim() } : {}),
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(f.wallets.length ? { wallets: f.wallets.map((w) => ({ chain: w.chain, address: w.address.trim() })) } : {}),
  };
}

/** PATCH body: cleared fields are sent as `null`; the wallet list is replaced. */
export function updateBody(f: CustomerForm) {
  return {
    name: f.name.trim() || null,
    email: f.email.trim() || null,
    description: f.description.trim() || null,
    wallets: f.wallets.map((w) => ({ chain: w.chain, address: w.address.trim() })),
  };
}

export function formOf(c: Customer | undefined): CustomerForm {
  return {
    name: c?.name ?? "",
    email: c?.email ?? "",
    description: c?.description ?? "",
    wallets: (c?.wallets ?? []).map((w, i) => ({ key: `w${i}`, chain: w.chain, address: w.address })),
  };
}

export interface Totals {
  /** Display text per pricing currency, e.g. `["$4,100.00", "20 USDC"]`. */
  readonly parts: readonly string[];
  readonly count: number;
  readonly lastPaid: number | null;
  /** More payments exist than were summed (first page only). */
  readonly partial: boolean;
}

/** Sum of succeeded payments per pricing currency/asset (bigint), plus the latest payment time. */
export function paidTotals(
  intents: readonly Pick<PaymentIntent, "status" | "amount" | "currency" | "asset_id" | "succeeded_at">[],
  assets: ReadonlyMap<string, { symbol: string; decimals: number }>,
  partial = false,
): Totals {
  const sums = new Map<string, bigint>();
  let count = 0;
  let last: number | null = null;
  for (const i of intents) {
    if (i.status !== "succeeded") continue;
    count++;
    const key = i.currency === "asset" ? `asset:${i.asset_id ?? ""}` : i.currency;
    sums.set(key, (sums.get(key) ?? 0n) + BigInt(i.amount));
    if (i.succeeded_at !== null && (last === null || i.succeeded_at > last)) last = i.succeeded_at;
  }
  const parts = [...sums.entries()].map(([k, v]) => {
    if (k.startsWith("asset:")) {
      const a = assets.get(k.slice(6));
      return a ? formatMoney({ amount: v, decimals: a.decimals, symbol: a.symbol }) : `${v} base units`;
    }
    const d = currencyDigits(k);
    const sym = ({ usd: "$", eur: "€", gbp: "£" } as Record<string, string>)[k] ?? k.toUpperCase();
    return formatMoney({ amount: v, decimals: d, symbol: sym, minFraction: d });
  });
  return { parts, count, lastPaid: last, partial };
}

/** "Today" / "Yesterday" / a date. */
export function relativeDay(unix: number | null, now = Date.now()): string {
  if (unix === null) return "—";
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const diff = Math.round((day(now) - day(unix * 1000)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(unix * 1000);
}

/**
 * Totals from the API (spec 0.2.1 `Customer.total_paid` / `last_payment_at`), or undefined when the server
 * does not send them yet (then the list falls back to summing the customer's succeeded payments).
 */
export function serverTotals(
  c: Pick<Customer, "total_paid" | "last_payment_at">,
  assets: ReadonlyMap<string, { symbol: string; decimals: number }>,
): Totals | undefined {
  if (!c.total_paid) return undefined;
  const parts = c.total_paid.map((t) =>
    t.currency === "asset"
      ? (() => {
          const a = assets.get(t.asset_id ?? "");
          return a
            ? formatMoney({ amount: String(t.amount), decimals: a.decimals, symbol: a.symbol })
            : `${t.amount} base units`;
        })()
      : (() => {
          const d = currencyDigits(t.currency);
          const sym =
            ({ usd: "$", eur: "€", gbp: "£" } as Record<string, string>)[t.currency] ?? t.currency.toUpperCase();
          return formatMoney({ amount: BigInt(t.amount), decimals: d, symbol: sym, minFraction: d });
        })(),
  );
  return {
    parts,
    count: c.total_paid.reduce((n, t) => n + t.count, 0),
    lastPaid: c.last_payment_at ?? null,
    partial: false,
  };
}
