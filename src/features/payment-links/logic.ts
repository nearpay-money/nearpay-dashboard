/**
 * Payment-link logic (lld/payments.md §17.11): price parsing into the spec's pricing shape (fiat =
 * integer minor units, asset = base-unit string; INV-5), price display, status labels.
 */

import { formatMoney } from "@nearpay-internal/ui";
import type { PaymentLink } from "@nearpay-money/spec";
import { currencyDigits } from "../../lib/money";

export interface AssetMeta {
  readonly symbol: string;
  readonly decimals: number;
}

export const FIAT_CURRENCIES = [
  { value: "usd", label: "USD" },
  { value: "eur", label: "EUR" },
  { value: "gbp", label: "GBP" },
] as const;

const SYMBOLS: Readonly<Record<string, string>> = { usd: "$", eur: "€", gbp: "£", jpy: "¥" };

export type Pricing =
  | { readonly currency: string; readonly amount: number; readonly asset_id?: undefined }
  | { readonly currency: "asset"; readonly amount: string; readonly asset_id: string };

export type PriceParse = { ok: true; pricing: Pricing } | { ok: false; error: string };

/** Decimal text → base-unit digits (no floats). */
function toUnits(text: string, decimals: number): { ok: true; value: bigint } | { ok: false; error: string } {
  const t = text.trim().replace(/,/g, "");
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (t === "" || !m || (m[1] === "" && (m[2] ?? "") === "")) return { ok: false, error: "Enter a price, like 49.00." };
  const frac = m[2] ?? "";
  if (frac.length > decimals)
    return {
      ok: false,
      error: decimals === 0 ? "This currency has no decimals." : `Use at most ${decimals} decimals.`,
    };
  return { ok: true, value: BigInt(`${m[1] || "0"}${frac.padEnd(decimals, "0")}`) };
}

/**
 * Price input → spec pricing. `currency` is a lower-case ISO code or `asset` (then `assetId` and the
 * asset's decimals are required).
 */
export function parsePrice(
  text: string,
  currency: string,
  asset?: { id: string; meta: AssetMeta | undefined },
): PriceParse {
  if (currency === "asset") {
    if (!asset?.meta) return { ok: false, error: "Choose the asset to price in." };
    const r = toUnits(text, asset.meta.decimals);
    if (!r.ok) return r;
    if (r.value <= 0n) return { ok: false, error: "Enter a price above zero." };
    return { ok: true, pricing: { currency: "asset", amount: r.value.toString(), asset_id: asset.id } };
  }
  const r = toUnits(text, currencyDigits(currency));
  if (!r.ok) return r;
  if (r.value <= 0n) return { ok: false, error: "Enter a price above zero." };
  if (r.value > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: "That price is too large." };
  return { ok: true, pricing: { currency, amount: Number(r.value) } };
}

/** `$49.00`, `€10.50`, `25 USDC`. */
export function priceText(
  p: { amount: number | string; currency: string; asset_id?: string | null },
  assets: ReadonlyMap<string, AssetMeta>,
): string {
  if (p.currency === "asset") {
    const a = p.asset_id ? assets.get(p.asset_id) : undefined;
    if (!a) return `${p.amount} base units`;
    return formatMoney({ amount: String(p.amount), decimals: a.decimals, symbol: a.symbol });
  }
  const digits = currencyDigits(p.currency);
  const sym = SYMBOLS[p.currency];
  return formatMoney({
    amount: BigInt(p.amount),
    decimals: digits,
    symbol: sym ?? p.currency.toUpperCase(),
    minFraction: digits,
  });
}

export function linkStatus(l: Pick<PaymentLink, "active" | "uses" | "max_uses">): {
  label: string;
  detail?: string;
} {
  if (l.max_uses !== null && l.uses >= l.max_uses) return { label: "Disabled", detail: "Usage limit reached" };
  return l.active ? { label: "Active" } : { label: "Disabled" };
}

export function usesText(l: Pick<PaymentLink, "uses" | "max_uses">): string {
  return l.max_uses === null ? String(l.uses) : `${l.uses} of ${l.max_uses}`;
}

/** A positive integer from a text field, or null when empty; `undefined` when invalid. */
export function optionalCount(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{1,9}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 ? n : undefined;
}

/** https URL (or http://localhost for development) for `success_url`; null when empty, undefined when invalid. */
export function optionalUrl(text: string): string | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  try {
    const u = new URL(t);
    if (u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost")) return u.toString();
    return undefined;
  } catch {
    return undefined;
  }
}

/** The shareable URL the API returned, if it is an https payer URL for this link. */
export function shareUrl(l: Pick<PaymentLink, "id" | "url">): string | null {
  try {
    const u = new URL(l.url);
    return (u.protocol === "https:" || u.hostname === "localhost") && u.pathname.endsWith(`/l/${l.id}`) ? l.url : null;
  } catch {
    return null;
  }
}
