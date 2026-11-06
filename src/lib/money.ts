/**
 * Display formatting of money (INV-5): integer minor units and base-unit strings are formatted with
 * bigint/string arithmetic only — no floating point.
 */

/** Minor-unit digits of an ISO 4217 currency (USD 2, JPY 0, …), from Intl. */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** `"2500000", 6` → `"2.5"`; trailing zeros trimmed down to `minDigits`. */
export function formatUnits(amount: string | number | bigint, decimals: number, minDigits = 0): string {
  let v = BigInt(amount);
  const neg = v < 0n;
  if (neg) v = -v;
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = decimals > 0 ? s.slice(0, s.length - decimals) : s;
  let frac = decimals > 0 ? s.slice(s.length - decimals) : "";
  while (frac.length > minDigits && frac.endsWith("0")) frac = frac.slice(0, -1);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** `4999, "usd"` → `"$49.99"` style (`USD 49.99` for codes without a symbol we know). */
export function formatFiat(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const n = formatUnits(BigInt(minor), digits, digits);
  const symbols: Record<string, string> = { usd: "$", eur: "€", gbp: "£", jpy: "¥" };
  const sym = symbols[currency.toLowerCase()];
  return sym ? `${sym}${n}` : `${n} ${currency.toUpperCase()}`;
}

export interface AssetInfo {
  readonly symbol: string;
  readonly decimals: number;
  readonly chain?: string;
}

/** Base units of an asset: `"2000000"` + USDC(6) → `"2 USDC"`; unknown asset → raw base units. */
export function formatAsset(amount: string, assetId: string, assets: ReadonlyMap<string, AssetInfo>): string {
  const a = assets.get(assetId);
  if (!a) return `${amount} base units`;
  return `${formatUnits(amount, a.decimals)} ${a.symbol}`;
}

/** A priced amount (`currency` fiat or `asset`). */
export function formatPrice(
  p: { amount: number | string; currency: string; asset_id?: string | null },
  assets: ReadonlyMap<string, AssetInfo>,
): string {
  if (p.currency === "asset") return formatAsset(String(p.amount), p.asset_id ?? "", assets);
  return formatFiat(Number(p.amount), p.currency);
}

/** Short asset label: symbol if known, else the token account. */
export function assetLabel(assetId: string, assets: ReadonlyMap<string, AssetInfo>): string {
  return assets.get(assetId)?.symbol ?? assetId.replace(/^nep\d+:/, "");
}
