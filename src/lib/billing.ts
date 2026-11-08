/**
 * Billing display and input rules shared by the Stage 3 feature modules (products, tax rates, invoices,
 * subscriptions; lld/billing.md §11, spec 0.3.0). Money stays integer (INV-5): fiat amounts are integer
 * minor units, asset amounts base-unit strings, tax rates exact decimal strings — no floats anywhere. Tax
 * previews use the spec's normative `computeInvoiceTotals` (the same code billing runs), so a draft's
 * preview equals what the server computes for the same lines and rates.
 */
import { computeInvoiceTotals, type InvoiceTotals, periodBoundary, type TaxRateInput } from "@nearpay/spec";
import { type AssetInfo, currencyDigits, formatPrice } from "./money";

/** Fiat currencies the forms offer (payments' default pricing currencies, rails §8). */
export const BILLING_CURRENCIES = [
  { value: "usd", label: "USD" },
  { value: "eur", label: "EUR" },
  { value: "gbp", label: "GBP" },
  { value: "chf", label: "CHF" },
  { value: "jpy", label: "JPY" },
  { value: "cad", label: "CAD" },
  { value: "aud", label: "AUD" },
] as const;

export interface Priced {
  readonly amount: number | string | bigint;
  readonly currency: string;
  readonly asset_id?: string | null;
}

/** `$49.00`, `¥500`, `25 USDC`; unknown asset → exact base units (never a guessed decimal point). */
export function amountText(p: Priced, assets: ReadonlyMap<string, AssetInfo>): string {
  return formatPrice({ amount: String(p.amount), currency: p.currency, asset_id: p.asset_id ?? null }, assets);
}

/** Decimals of a pricing currency (`asset` → the asset's decimals, undefined when unknown). */
export function pricingDecimals(
  currency: string,
  assetId: string | null | undefined,
  assets: ReadonlyMap<string, AssetInfo>,
): number | undefined {
  if (currency === "asset") return assetId ? assets.get(assetId)?.decimals : undefined;
  return currencyDigits(currency);
}

export type AmountParse = { ok: true; amount: number | string; units: bigint } | { ok: false; error: string };

/**
 * A typed amount (`"49"`, `"1,249.50"`) → the spec's pricing amount: integer minor units (number) for
 * fiat, a base-unit string for assets. Exact decimal parsing; at most the currency's decimals.
 */
export function parseAmount(
  text: string,
  currency: string,
  decimals: number | undefined,
  opts: { allowZero?: boolean } = {},
): AmountParse {
  if (decimals === undefined) return { ok: false, error: "Choose the asset to price in." };
  const t = text.trim().replace(/,/g, "");
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (t === "" || !m || (m[1] === "" && (m[2] ?? "") === ""))
    return { ok: false, error: "Enter an amount, like 49.00." };
  const frac = m[2] ?? "";
  if (frac.length > decimals)
    return {
      ok: false,
      error: decimals === 0 ? "This currency has no decimals." : `Use at most ${decimals} decimals.`,
    };
  const units = BigInt(`${m[1] || "0"}${frac.padEnd(decimals, "0")}`);
  if (units === 0n && !opts.allowZero) return { ok: false, error: "Enter an amount above zero." };
  if (currency === "asset") {
    if (units.toString().length > 78) return { ok: false, error: "That amount is too large." };
    return { ok: true, amount: units.toString(), units };
  }
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: "That amount is too large." };
  return { ok: true, amount: Number(units), units };
}

/** Integer units → the decimal text a form field shows (`4900`, 2 → `"49.00"`). */
export function unitsToInput(amount: number | string | bigint, decimals: number): string {
  const s = BigInt(amount)
    .toString()
    .padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

export interface RecurringLike {
  readonly interval: string;
  readonly interval_count: number;
}

/** `month` / `3 months` / `week` / `2 years`. */
export function intervalText(r: RecurringLike): string {
  return r.interval_count === 1 ? r.interval : `${r.interval_count} ${r.interval}s`;
}

/** `/month` for single units, ` every 3 months` otherwise (appended to an amount). */
export function perIntervalText(r: RecurringLike): string {
  return r.interval_count === 1 ? `/${r.interval}` : ` every ${r.interval_count} ${r.interval}s`;
}

/** `$49.00/month`, `$249.00 every 3 months`, `$99.00 one-time`. */
export function priceSummary(
  p: { unit_amount: number | string; currency: string; asset_id: string | null; recurring: RecurringLike | null },
  assets: ReadonlyMap<string, AssetInfo>,
): string {
  const a = amountText({ amount: p.unit_amount, currency: p.currency, asset_id: p.asset_id }, assets);
  return p.recurring ? `${a}${perIntervalText(p.recurring)}` : `${a} one-time`;
}

/**
 * A typed tax percentage → the spec's exact decimal string (0–100, ≤ 4 decimals), normalised (`"08.50"`
 * → `"8.5"`, `"19."` → `"19"`); null when it is not one. Never goes through a float.
 */
export function parseTaxPercentage(text: string): string | null {
  const t = text.trim().replace(/\s*%$/, "");
  const m = /^(\d{1,3})(?:\.(\d{0,4}))?$/.exec(t);
  if (!m) return null;
  const int = String(Number(m[1]));
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (Number(int) > 100 || (Number(int) === 100 && frac !== "")) return null;
  return frac ? `${int}.${frac}` : int;
}

/** `19%`, `8.875%`. */
export const percentText = (percentage: string): string => `${percentage}%`;

/** `VAT · 19% · exclusive`, with the jurisdiction when set. */
export function taxRateLabel(t: {
  display_name: string;
  percentage: string;
  inclusive: boolean;
  jurisdiction?: string | null;
}): string {
  const where = t.jurisdiction ? ` (${t.jurisdiction})` : "";
  return `${t.display_name}${where} · ${percentText(t.percentage)} · ${t.inclusive ? "inclusive" : "exclusive"}`;
}

export interface PreviewLine {
  /** Unit amount in integer units of the invoice currency. */
  readonly unitAmount: bigint;
  readonly quantity: number;
  readonly taxRates: readonly TaxRateInput[];
}

export type Preview = { ok: true; totals: InvoiceTotals } | { ok: false; error: string; line: number };

/** Invoice totals for draft lines with the spec's normative arithmetic (per-line tax, round half-up). */
export function previewTotals(lines: readonly PreviewLine[]): Preview {
  for (const [i, l] of lines.entries()) {
    const incl = l.taxRates.map((r) => r.inclusive);
    if (incl.some((x) => x !== incl[0]))
      return { ok: false, line: i, error: "A line can't mix inclusive and exclusive tax rates." };
  }
  return {
    ok: true,
    totals: computeInvoiceTotals(
      lines.map((l) => ({ amount: l.unitAmount * BigInt(l.quantity), tax_rates: l.taxRates })),
    ),
  };
}

/**
 * The period after the current one of a subscription (the period its next renewal invoice bills),
 * following `periodBoundary` from the anchor (during a trial the anchor is `trial_end` = the current
 * period end, so the first invoice bills boundary 0 → 1). Undefined when `current_period_end` is not a
 * boundary of the anchor's schedule (it always is for subscriptions the API returns).
 */
export function nextPeriod(s: {
  billing_cycle_anchor: number;
  current_period_end: number;
  recurring: RecurringLike;
}): { start: number; end: number } | undefined {
  const interval = s.recurring.interval as "day" | "week" | "month" | "year";
  if (!["day", "week", "month", "year"].includes(interval)) return undefined;
  for (let n = 0; n <= 5000; n++) {
    const b = periodBoundary(s.billing_cycle_anchor, interval, s.recurring.interval_count, n);
    if (b === s.current_period_end) {
      return {
        start: b,
        end: periodBoundary(s.billing_cycle_anchor, interval, s.recurring.interval_count, n + 1),
      };
    }
    if (b > s.current_period_end) return undefined;
  }
  return undefined;
}

/** Local calendar date `YYYY-MM-DD` of a unix time (for `<input type="date">`). */
export function dateInputValue(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `YYYY-MM-DD` → end of that local day as unix seconds (an invoice is due through the whole day). */
export function dueDateFromInput(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  if (d.getMonth() !== Number(m[2]) - 1) return undefined;
  return Math.floor(d.getTime() / 1000);
}

/** Reminder offsets in words: `3 days before, on the due date, 1 day after`. */
export function reminderDaysText(days: readonly number[]): string {
  if (days.length === 0) return "No reminders";
  return days
    .map((d) =>
      d === 0 ? "on the due date" : `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ${d < 0 ? "before" : "after"}`,
    )
    .join(", ");
}

/** A typed reminder schedule (`-3, 0, 1, 7`) → strictly increasing offsets −30…+60 (≤ 10), or an error. */
export function parseReminderDays(text: string): { ok: true; days: number[] } | { ok: false; error: string } {
  const parts = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 10) return { ok: false, error: "Use at most 10 reminders." };
  const days: number[] = [];
  for (const p of parts) {
    if (!/^[+-]?\d{1,2}$/.test(p)) return { ok: false, error: "Use whole days, like -3, 0, 1, 7." };
    const d = Number(p);
    if (d < -30 || d > 60) return { ok: false, error: "Each reminder must be 30 days before to 60 days after." };
    if (days.length && d <= (days[days.length - 1] as number))
      return { ok: false, error: "List the days in increasing order, each once." };
    days.push(d);
  }
  return { ok: true, days };
}

export interface InvoiceLike {
  readonly status: string;
  readonly due_date: number | null;
  readonly reminder_days: readonly number[];
  readonly reminders_sent: number;
  readonly next_reminder_at: number | null;
  readonly amount_remaining: number | string;
}

/** An `open` invoice whose due date has passed (shown as "Past due"; the API status stays `open`). */
export const isPastDue = (i: Pick<InvoiceLike, "status" | "due_date">, now: number): boolean =>
  i.status === "open" && i.due_date !== null && i.due_date < now;

export type DunningState =
  | { kind: "none" }
  | { kind: "scheduled"; sent: number; total: number; next: number | null }
  | { kind: "exhausted"; sent: number; total: number };

/** Where an invoice is in its reminder schedule (lld/billing.md §11 d8, §12 d2–d3). */
export function dunningState(i: InvoiceLike): DunningState {
  const total = i.reminder_days.length;
  if (total === 0 || !["open", "uncollectible"].includes(i.status)) return { kind: "none" };
  if (i.next_reminder_at !== null)
    return { kind: "scheduled", sent: i.reminders_sent, total, next: i.next_reminder_at };
  if (i.status === "uncollectible" || i.reminders_sent > 0) return { kind: "exhausted", sent: i.reminders_sent, total };
  return { kind: "scheduled", sent: 0, total, next: null };
}

/** Minimum gap between two "Send invoice" emails (spec `sendInvoice`: one mail per invoice per 10 minutes). */
export const SEND_INTERVAL_S = 600;

/** Seconds until the invoice can be emailed again (0 = now). */
export function sendCooldown(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  return Math.max(0, sentAt + SEND_INTERVAL_S - now);
}

/** `9:41` → `"9 min 41 s"`; under a minute → `"41 s"`. */
export function durationText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

export interface MoneySummary {
  /** Formatted sum in the most common currency, or "—" when there is nothing. */
  readonly text: string;
  /** Other currencies present (not converted — no FX in totals). */
  readonly others: number;
  /** Items in the main currency. */
  readonly count: number;
}

/** Sums amounts per pricing currency (bigint) and shows the currency with the most items. */
export function summarizeAmounts(items: readonly Priced[], assets: ReadonlyMap<string, AssetInfo>): MoneySummary {
  const by = new Map<string, { sum: bigint; n: number; p: Priced }>();
  for (const p of items) {
    const key = p.currency === "asset" ? `asset:${p.asset_id ?? ""}` : p.currency;
    const e = by.get(key) ?? { sum: 0n, n: 0, p };
    e.sum += BigInt(p.amount);
    e.n++;
    by.set(key, e);
  }
  let best: { sum: bigint; n: number; p: Priced } | undefined;
  for (const e of by.values()) if (!best || e.n > best.n) best = e;
  if (!best) return { text: "—", others: 0, count: 0 };
  return { text: amountText({ ...best.p, amount: best.sum }, assets), others: by.size - 1, count: best.n };
}
