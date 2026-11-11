/**
 * Home numbers from real payment intents (no analytics endpoint in v1): settled volume and trend,
 * successful payments of those started, average payment, what needs attention, and daily volume split by
 * the chain the customer paid from (the paying attempt's `origin_chain`) for the chart. Amounts are summed as
 * bigint minor units of one fiat currency (INV-5); percentages are display-only ratios.
 */
import type { PaymentIntent } from "@nearpay-money/spec";

type Attempt = Pick<PaymentIntent["attempts"][number], "status" | "origin_chain" | "is_overpayment"> & {
  readonly created?: number;
};
type Intent = Pick<PaymentIntent, "status" | "amount" | "currency" | "created" | "succeeded_at"> & {
  readonly attempts?: readonly Attempt[];
};

export interface DayBucket {
  /** Local midnight (unix seconds) of the day. */
  readonly start: number;
  readonly value: bigint;
  /** The day's volume by the chain the customer paid from (CAIP-2 id; `""` when no attempt says). */
  readonly byChain: ReadonlyMap<string, bigint>;
}

export interface OverviewSummary {
  /** Fiat currency the volume is shown in (the most used one in the window), lower case. */
  readonly currency: string;
  readonly volume: bigint;
  readonly previousVolume: bigint;
  /** Change vs the previous period in tenths of a percent, or null without a previous volume. */
  readonly trendPermille: number | null;
  readonly succeeded: number;
  readonly total: number;
  /** Succeeded share of payments created in the period, in tenths of a percent (null when none). */
  readonly completionPermille: number | null;
  readonly reviews: number;
  /** Payments still confirming after `DELAYED_AFTER_S`. */
  readonly delayed: number;
  /** Succeeded payments priced in another currency or an asset (not in `volume`). */
  readonly otherCurrency: number;
  readonly days: readonly DayBucket[];
  /** Succeeded payments in `currency` in the period (the base of `average`). */
  readonly paidInCurrency: number;
  /** Average succeeded payment in `currency` (bigint floor division), or null with none. */
  readonly average: bigint | null;
  /** Origin chains by volume in the period, largest first. */
  readonly chains: readonly { readonly chain: string; readonly value: bigint }[];
  /** Latest `succeeded_at` among the intents (unix seconds), or null. */
  readonly lastPaidAt: number | null;
  /**
   * Median seconds from the customer choosing how to pay (the paying attempt's `created`, when the quote is
   * made) to the payment succeeding, over the period's succeeded payments; null with none. The API has no
   * deposit timestamp, so this is the closest honest "time to paid".
   */
  readonly medianToPaid: number | null;
}

/** Median of whole seconds (lower middle for an even count, so it is always an observed value). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor((v.length - 1) / 2)] as number;
}

/** `4` → `"4 s"`, `95` → `"1 min 35 s"`, `720` → `"12 min"`, `4000` → `"1 h 7 min"`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const m = Math.round((s % 3600) / 60);
  return m ? `${Math.floor(s / 3600)} h ${m} min` : `${Math.floor(s / 3600)} h`;
}

/** The chain the customer paid from: the attempt that paid the intent (not an overpayment), else the newest. */
export function paidFromChain(pi: { readonly attempts?: readonly Attempt[] }): string {
  const a = pi.attempts ?? [];
  return (
    a.find((x) => x.status === "succeeded" && !x.is_overpayment)?.origin_chain ??
    a.find((x) => x.status === "succeeded")?.origin_chain ??
    a[0]?.origin_chain ??
    ""
  );
}

export const PERIOD_DAYS = 7;
export const DELAYED_AFTER_S = 30 * 60;

/** Local midnight of the day containing `unix`. */
export function startOfDay(unix: number): number {
  const d = new Date(unix * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function summarize(intents: readonly Intent[], nowSec: number, days = PERIOD_DAYS): OverviewSummary {
  const today = startOfDay(nowSec);
  const starts: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today * 1000);
    d.setDate(d.getDate() - i);
    starts.push(Math.floor(d.getTime() / 1000));
  }
  const periodStart = starts[0] ?? today;
  const prevDate = new Date(periodStart * 1000);
  prevDate.setDate(prevDate.getDate() - days);
  const prevStart = Math.floor(prevDate.getTime() / 1000);

  // the most used fiat currency among succeeded payments of both periods (USD when there are none)
  const counts = new Map<string, number>();
  for (const pi of intents)
    if (pi.status === "succeeded" && pi.currency !== "asset" && pi.created >= prevStart)
      counts.set(pi.currency, (counts.get(pi.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "usd";

  let volume = 0n;
  let previousVolume = 0n;
  let succeeded = 0;
  let total = 0;
  let reviews = 0;
  let delayed = 0;
  let otherCurrency = 0;
  let paidInCurrency = 0;
  let lastPaidAt: number | null = null;
  const toPaid: number[] = [];
  const buckets = starts.map(() => 0n);
  const chainBuckets = starts.map(() => new Map<string, bigint>());
  const chainTotals = new Map<string, bigint>();
  for (const pi of intents) {
    if (pi.status === "requires_review") reviews++;
    if (pi.status === "processing" && nowSec - pi.created > DELAYED_AFTER_S) delayed++;
    const inPeriod = pi.created >= periodStart;
    const inPrev = pi.created >= prevStart && pi.created < periodStart;
    if (inPeriod) total++;
    if (pi.status !== "succeeded") continue;
    if (pi.succeeded_at != null && (lastPaidAt === null || pi.succeeded_at > lastPaidAt)) lastPaidAt = pi.succeeded_at;
    if (inPeriod) {
      succeeded++;
      const a =
        pi.attempts?.find((x) => x.status === "succeeded" && !x.is_overpayment) ??
        pi.attempts?.find((x) => x.status === "succeeded");
      if (a?.created !== undefined && pi.succeeded_at != null && pi.succeeded_at >= a.created)
        toPaid.push(pi.succeeded_at - a.created);
    }
    if (pi.currency !== currency) {
      if (inPeriod) otherCurrency++;
      continue;
    }
    const amount = BigInt(pi.amount);
    if (inPrev) previousVolume += amount;
    if (!inPeriod) continue;
    volume += amount;
    paidInCurrency++;
    const at = pi.succeeded_at ?? pi.created;
    let idx = starts.length - 1;
    while (idx > 0 && at < (starts[idx] as number)) idx--;
    buckets[idx] = (buckets[idx] as bigint) + amount;
    const chain = paidFromChain(pi);
    const day = chainBuckets[idx] as Map<string, bigint>;
    day.set(chain, (day.get(chain) ?? 0n) + amount);
    chainTotals.set(chain, (chainTotals.get(chain) ?? 0n) + amount);
  }
  const permille = (num: bigint, den: bigint) => Number((num * 1000n) / den);
  return {
    currency,
    volume,
    previousVolume,
    trendPermille: previousVolume > 0n ? permille(volume - previousVolume, previousVolume) : null,
    succeeded,
    total,
    completionPermille: total > 0 ? permille(BigInt(succeeded), BigInt(total)) : null,
    reviews,
    delayed,
    otherCurrency,
    days: starts.map((start, i) => ({
      start,
      value: buckets[i] as bigint,
      byChain: chainBuckets[i] as Map<string, bigint>,
    })),
    paidInCurrency,
    average: paidInCurrency > 0 ? volume / BigInt(paidInCurrency) : null,
    chains: [...chainTotals.entries()]
      .map(([chain, value]) => ({ chain, value }))
      .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : a.chain.localeCompare(b.chain))),
    lastPaidAt,
    medianToPaid: median(toPaid),
  };
}

/** `124` → `"+12.4%"`, `-5` → `"−0.5%"`. */
export function formatPermille(p: number, signed = false): string {
  const abs = Math.abs(p);
  const s = `${Math.floor(abs / 10)}.${abs % 10}%`;
  if (!signed) return s;
  return p > 0 ? `+${s}` : p < 0 ? `−${s}` : s;
}
