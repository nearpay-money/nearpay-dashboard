/** Product and price form rules (lld/billing.md §5; spec `billing-catalog`): pricing is immutable once created. */

import { parseAmount } from "../../lib/billing";
import { type AssetInfo, currencyDigits } from "../../lib/money";

export interface PriceForm {
  readonly amount: string;
  readonly currency: string;
  readonly assetId: string;
  readonly type: "one_time" | "recurring";
  readonly interval: "day" | "week" | "month" | "year";
  readonly intervalCount: string;
  readonly nickname: string;
}

export const emptyPrice = (): PriceForm => ({
  amount: "",
  currency: "usd",
  assetId: "",
  type: "recurring",
  interval: "month",
  intervalCount: "1",
  nickname: "",
});

export type PriceErrors = Partial<Record<"amount" | "currency" | "intervalCount" | "nickname", string>>;

export interface PriceBody {
  unit_amount: number | string;
  currency: string;
  asset_id?: string;
  recurring?: { interval: PriceForm["interval"]; interval_count: number };
  nickname?: string;
}

/** Price form → `createPrice` body (without `product`), exact decimal parsing (INV-5). */
export function checkPrice(
  f: PriceForm,
  assets: ReadonlyMap<string, AssetInfo>,
): { errors: PriceErrors; body: PriceBody | undefined } {
  const errors: PriceErrors = {};
  if (f.currency === "asset" && !f.assetId) errors.currency = "Choose the asset to price in.";
  const decimals = f.currency === "asset" ? assets.get(f.assetId)?.decimals : currencyDigits(f.currency);
  const a = parseAmount(f.amount, f.currency, f.currency === "asset" && !f.assetId ? 0 : decimals);
  if (!a.ok) errors.amount = a.error;
  let count = 1;
  if (f.type === "recurring") {
    count = /^\d{1,2}$/.test(f.intervalCount.trim()) ? Number(f.intervalCount.trim()) : 0;
    if (count < 1 || count > 12) errors.intervalCount = "Enter 1 to 12.";
  }
  if (f.nickname.trim().length > 100) errors.nickname = "Use at most 100 characters.";
  if (Object.keys(errors).length || !a.ok) return { errors, body: undefined };
  return {
    errors,
    body: {
      unit_amount: a.amount,
      currency: f.currency,
      ...(f.currency === "asset" ? { asset_id: f.assetId } : {}),
      ...(f.type === "recurring" ? { recurring: { interval: f.interval, interval_count: count } } : {}),
      ...(f.nickname.trim() ? { nickname: f.nickname.trim() } : {}),
    },
  };
}

export function checkProductName(name: string, description: string): Partial<Record<"name" | "description", string>> {
  const e: Partial<Record<"name" | "description", string>> = {};
  if (!name.trim()) e.name = "Enter the product name.";
  else if (name.trim().length > 250) e.name = "Use at most 250 characters.";
  if (description.trim().length > 1000) e.description = "Use at most 1,000 characters.";
  return e;
}
