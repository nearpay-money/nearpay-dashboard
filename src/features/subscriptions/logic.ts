/**
 * Subscription logic (lld/billing.md §4, §11 d8–d9; spec `subscriptions`): the create form ↔ API body,
 * per-period totals, the upcoming renewal invoice (estimated client-side from the items, current tax
 * rates and `periodBoundary`; billing reprices at renewal, §12 d6), allowed actions and dunning copy.
 */
import type { Price, Subscription, TaxRate, TaxRateInput } from "@nearpay/spec";
import {
  intervalText,
  nextPeriod,
  type Preview,
  type PreviewLine,
  parseReminderDays,
  previewTotals,
  reminderDaysText,
} from "../../lib/billing";

export interface ItemRow {
  readonly key: string;
  readonly price: string;
  readonly quantity: string;
  /** null = the subscription's default tax rates. */
  readonly taxRates: readonly string[] | null;
}

export interface SubscriptionForm {
  readonly customer: string;
  readonly items: readonly ItemRow[];
  readonly trialDays: string;
  readonly daysUntilDue: string;
  readonly defaultTaxRates: readonly string[];
  readonly reminders: string;
  readonly onExhausted: "cancel" | "unpaid";
  readonly description: string;
}

let seq = 0;
export const newItem = (over: Partial<ItemRow> = {}): ItemRow => ({
  key: `i${++seq}`,
  price: "",
  quantity: "1",
  taxRates: null,
  ...over,
});

export const emptySubscription = (): SubscriptionForm => ({
  customer: "",
  items: [newItem()],
  trialDays: "",
  daysUntilDue: "7",
  defaultTaxRates: [],
  reminders: "-3, 0, 1, 3, 7",
  onExhausted: "cancel",
  description: "",
});

export type SubErrors = Partial<
  Record<"customer" | "items" | "trialDays" | "daysUntilDue" | "reminders" | "description", string>
> & { readonly item?: Readonly<Record<string, Partial<Record<"price" | "quantity" | "tax", string>>>> };

export interface SubBody {
  customer: string;
  items: { price: string; quantity: number; tax_rates?: string[] }[];
  days_until_due: number;
  trial_period_days?: number;
  default_tax_rates: string[];
  dunning: { reminder_days: number[]; on_exhausted: "cancel" | "unpaid" };
  description?: string;
}

const toInput = (t: TaxRate): TaxRateInput => ({ id: t.id, rate_ppm: t.rate_ppm, inclusive: t.inclusive });
const intInRange = (s: string, min: number, max: number): number | undefined => {
  const t = s.trim();
  if (!/^\d{1,4}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= min && n <= max ? n : undefined;
};

/** Validates the form; `body` is set when it can be sent (`createSubscription`). */
export function checkSubscription(
  f: SubscriptionForm,
  prices: ReadonlyMap<string, Price>,
  taxRates: ReadonlyMap<string, TaxRate>,
): { errors: SubErrors; preview: Preview; body: SubBody | undefined; schedule: Price["recurring"] | undefined } {
  const errors: { -readonly [K in keyof SubErrors]: SubErrors[K] } = {};
  const itemErrors: Record<string, Partial<Record<"price" | "quantity" | "tax", string>>> = {};
  if (!f.customer) errors.customer = "Choose the customer to bill.";
  if (f.items.length === 0) errors.items = "Add at least one price.";
  if (f.items.length > 20) errors.items = "Use at most 20 prices.";
  const trial = f.trialDays.trim() === "" ? null : intInRange(f.trialDays, 1, 730);
  if (trial === undefined) errors.trialDays = "Enter 1 to 730 days, or leave empty for no trial.";
  const due = intInRange(f.daysUntilDue, 0, 90);
  if (due === undefined) errors.daysUntilDue = "Enter 0 to 90 days.";
  const reminders = parseReminderDays(f.reminders);
  if (!reminders.ok) errors.reminders = reminders.error;
  if (f.description.trim().length > 500) errors.description = "Use at most 500 characters.";

  let first: Price | undefined;
  const lines: PreviewLine[] = [];
  const items: SubBody["items"] = [];
  for (const it of f.items) {
    const e: Partial<Record<"price" | "quantity" | "tax", string>> = {};
    const p = it.price ? prices.get(it.price) : undefined;
    const qty = intInRange(it.quantity, 1, 9999) ?? 0;
    if (!qty) e.quantity = "Enter a quantity from 1 to 9,999.";
    if (!p) e.price = "Choose a recurring price.";
    else if (!p.recurring) e.price = "Subscriptions need a recurring price.";
    else if (first) {
      if (p.currency !== first.currency || p.asset_id !== first.asset_id)
        e.price = "All prices must use the same currency.";
      else if (
        p.recurring.interval !== first.recurring?.interval ||
        p.recurring.interval_count !== first.recurring?.interval_count
      )
        e.price = `All prices must bill every ${first.recurring ? intervalText(first.recurring) : "period"}.`;
    } else first = p;
    const ids = it.taxRates ?? f.defaultTaxRates;
    const rates = ids.map((id) => taxRates.get(id)).filter((t): t is TaxRate => t !== undefined);
    if (ids.length > 5) e.tax = "Use at most 5 tax rates per price.";
    else if (rates.some((r) => r.inclusive !== rates[0]?.inclusive))
      e.tax = "A price can't mix inclusive and exclusive tax rates.";
    if (p)
      lines.push({ unitAmount: BigInt(p.unit_amount), quantity: qty || 1, taxRates: e.tax ? [] : rates.map(toInput) });
    items.push({
      price: it.price,
      quantity: qty || 1,
      ...(it.taxRates === null ? {} : { tax_rates: [...it.taxRates] }),
    });
    if (Object.keys(e).length) itemErrors[it.key] = e;
  }
  if (Object.keys(itemErrors).length) errors.item = itemErrors;
  const ok = Object.keys(errors).length === 0;
  return {
    errors,
    preview: previewTotals(lines),
    schedule: first?.recurring ?? undefined,
    body:
      ok && due !== undefined && reminders.ok
        ? {
            customer: f.customer,
            items,
            days_until_due: due,
            ...(trial ? { trial_period_days: trial } : {}),
            default_tax_rates: [...f.defaultTaxRates],
            dunning: { reminder_days: reminders.days, on_exhausted: f.onExhausted },
            ...(f.description.trim() ? { description: f.description.trim() } : {}),
          }
        : undefined,
  };
}

export interface UpcomingRenewal {
  readonly start: number;
  readonly end: number;
  readonly preview: Preview;
  /** Some tax rates of the items were not found (beyond the loaded list): tax may be understated. */
  readonly ratesMissing: boolean;
}

/**
 * The next renewal invoice (period after the current one) as billing would create it today: items ×
 * current price snapshot, item or default tax rates. Undefined when no renewal will happen (canceled,
 * cancel at period end, `unpaid`/`incomplete` subscriptions create no renewal invoices).
 */
export function upcomingRenewal(
  s: Pick<
    Subscription,
    | "status"
    | "cancel_at_period_end"
    | "items"
    | "default_tax_rates"
    | "billing_cycle_anchor"
    | "current_period_end"
    | "recurring"
    | "trial_end"
  >,
  taxRates: ReadonlyMap<string, TaxRate>,
): UpcomingRenewal | undefined {
  if (s.cancel_at_period_end || !["active", "past_due", "trialing"].includes(s.status)) return undefined;
  const period = nextPeriod(s);
  if (!period) return undefined;
  let missing = false;
  const lines: PreviewLine[] = s.items.map((it) => {
    const ids = it.tax_rates ?? s.default_tax_rates;
    const rates = ids.map((id) => taxRates.get(id));
    if (rates.some((r) => r === undefined)) missing = true;
    return {
      unitAmount: BigInt(it.price.unit_amount),
      quantity: it.quantity,
      taxRates: rates.filter((r): r is TaxRate => r !== undefined).map(toInput),
    };
  });
  return { start: period.start, end: period.end, preview: previewTotals(lines), ratesMissing: missing };
}

export function subscriptionActions(s: Pick<Subscription, "status" | "cancel_at_period_end">) {
  const live = s.status !== "canceled";
  return {
    cancelNow: live,
    cancelAtPeriodEnd: live && !s.cancel_at_period_end,
    undoCancel: live && s.cancel_at_period_end,
  };
}

/** What happens when reminders run out (subscription `dunning.on_exhausted`). */
export function dunningText(d: Subscription["dunning"]): string {
  const when = d.reminder_days.length ? `Reminders ${reminderDaysText(d.reminder_days)} the due date` : "No reminders";
  const after =
    d.on_exhausted === "unpaid"
      ? "if still unpaid after the last one, the subscription becomes Unpaid and stops invoicing until paid"
      : "if still unpaid after the last one, the subscription is canceled";
  return `${when}; ${after}.`;
}

/** "Next invoice" column/stat: the renewal date, or why there is none. */
export function nextInvoiceText(
  s: Pick<Subscription, "status" | "cancel_at_period_end" | "current_period_end" | "trial_end">,
  fmt: (unix: number) => string,
): string {
  if (s.status === "canceled") return "—";
  if (s.cancel_at_period_end) return `Cancels ${fmt(s.current_period_end)}`;
  if (s.status === "unpaid") return "Paused until paid";
  if (s.status === "incomplete") return "After the first payment";
  if (s.status === "trialing" && s.trial_end) return fmt(s.trial_end);
  return fmt(s.current_period_end);
}
