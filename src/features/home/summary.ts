/**
 * Overview numbers from real payment intents (no analytics endpoint in v1): settled volume and trend,
 * successful payments, what needs attention, and daily volume for the chart. Amounts are summed as
 * bigint minor units of one fiat currency (INV-5); percentages are display-only ratios.
 */
import type { PaymentIntent } from "@nearpay/spec";

type Intent = Pick<PaymentIntent, "status" | "amount" | "currency" | "created" | "succeeded_at">;

export interface DayBucket {
  /** Local midnight (unix seconds) of the day. */
  readonly start: number;
  readonly value: bigint;
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
  const buckets = starts.map(() => 0n);
  for (const pi of intents) {
    if (pi.status === "requires_review") reviews++;
    if (pi.status === "processing" && nowSec - pi.created > DELAYED_AFTER_S) delayed++;
    const inPeriod = pi.created >= periodStart;
    const inPrev = pi.created >= prevStart && pi.created < periodStart;
    if (inPeriod) total++;
    if (pi.status !== "succeeded") continue;
    if (inPeriod) succeeded++;
    if (pi.currency !== currency) {
      if (inPeriod) otherCurrency++;
      continue;
    }
    const amount = BigInt(pi.amount);
    if (inPrev) previousVolume += amount;
    if (!inPeriod) continue;
    volume += amount;
    const at = pi.succeeded_at ?? pi.created;
    let idx = starts.length - 1;
    while (idx > 0 && at < (starts[idx] as number)) idx--;
    buckets[idx] = (buckets[idx] as bigint) + amount;
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
    days: starts.map((start, i) => ({ start, value: buckets[i] as bigint })),
  };
}

/** `124` → `"+12.4%"`, `-5` → `"−0.5%"`. */
export function formatPermille(p: number, signed = false): string {
  const abs = Math.abs(p);
  const s = `${Math.floor(abs / 10)}.${abs % 10}%`;
  if (!signed) return s;
  return p > 0 ? `+${s}` : p < 0 ? `−${s}` : s;
}
