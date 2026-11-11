/**
 * Invoice logic (lld/billing.md §5, §11; spec `invoices`): the draft form ↔ API body, the live
 * totals preview (spec `computeInvoiceTotals`, INV-5), which actions a status allows, and the activity
 * timeline built from the invoice's events and status transitions.
 */
import type { Invoice, Price, TaxRate, TaxRateInput } from "@nearpay-money/spec";
import {
  dateInputValue,
  dueDateFromInput,
  type PreviewLine,
  parseAmount,
  parseReminderDays,
  pricingDecimals,
  unitsToInput,
} from "../../lib/billing";
import type { AssetInfo } from "../../lib/money";

export interface DraftLine {
  readonly key: string;
  /** `""` = custom amount, else a one-time price id. */
  readonly price: string;
  readonly description: string;
  readonly amount: string;
  readonly quantity: string;
  /** null = the invoice's default tax rates; otherwise this line's own (possibly empty) list. */
  readonly taxRates: readonly string[] | null;
}

export interface DraftForm {
  readonly customer: string;
  /** Lower-case ISO code or `asset`. */
  readonly currency: string;
  readonly assetId: string;
  /** `YYYY-MM-DD` (local) or `""` = 30 days after finalize. */
  readonly dueDate: string;
  readonly lines: readonly DraftLine[];
  readonly defaultTaxRates: readonly string[];
  readonly memo: string;
  readonly footer: string;
  /** Reminder days as typed (`-3, 0, 1, 3, 7`). */
  readonly reminders: string;
}

let lineSeq = 0;
export const newLine = (over: Partial<DraftLine> = {}): DraftLine => ({
  key: `l${++lineSeq}`,
  price: "",
  description: "",
  amount: "",
  quantity: "1",
  taxRates: null,
  ...over,
});

export const DEFAULT_REMINDERS = "-3, 0, 1, 3, 7";

export function emptyForm(now = Date.now()): DraftForm {
  return {
    customer: "",
    currency: "usd",
    assetId: "",
    dueDate: dateInputValue(Math.floor(now / 1000) + 30 * 86_400),
    lines: [newLine()],
    defaultTaxRates: [],
    memo: "",
    footer: "",
    reminders: DEFAULT_REMINDERS,
  };
}

/** A draft invoice → the form (prices are kept as price lines; amounts shown in the invoice currency). */
export function formFromInvoice(inv: Invoice, assets: ReadonlyMap<string, AssetInfo>): DraftForm {
  const decimals = pricingDecimals(inv.currency, inv.asset_id, assets) ?? 0;
  return {
    customer: inv.customer,
    currency: inv.currency,
    assetId: inv.asset_id ?? "",
    dueDate: inv.due_date ? dateInputValue(inv.due_date) : "",
    lines: inv.lines.map((l) =>
      newLine({
        price: l.price ?? "",
        description: l.price ? "" : l.description,
        amount: l.price ? "" : unitsToInput(l.unit_amount, decimals),
        quantity: String(l.quantity),
        taxRates: sameSet(l.tax_rates, inv.default_tax_rates) ? null : l.tax_rates,
      }),
    ),
    defaultTaxRates: inv.default_tax_rates,
    memo: inv.description ?? "",
    footer: inv.footer ?? "",
    reminders: inv.reminder_days.join(", "),
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

export type FormErrors = Partial<
  Record<"customer" | "currency" | "dueDate" | "lines" | "reminders" | "memo" | "footer", string>
> & {
  readonly line?: Readonly<
    Record<string, Partial<Record<"price" | "description" | "amount" | "quantity" | "tax", string>>>
  >;
};

export interface Catalogue {
  readonly prices: ReadonlyMap<string, Price>;
  readonly taxRates: ReadonlyMap<string, TaxRate>;
  readonly assets: ReadonlyMap<string, AssetInfo>;
}

type LineBody =
  | { price: string; quantity: number; description?: string; tax_rates?: string[] }
  | { unit_amount: number | string; description: string; quantity: number; tax_rates?: string[] };

export interface DraftBody {
  customer: string;
  currency: string;
  asset_id?: string;
  lines: LineBody[];
  default_tax_rates: string[];
  description?: string;
  footer?: string;
  due_date?: number;
  reminder_days: number[];
}

export interface Checked {
  readonly errors: FormErrors;
  /** Preview lines (invalid amounts count as 0 so the summary keeps updating while typing). */
  readonly preview: readonly PreviewLine[];
  readonly body: DraftBody | undefined;
}

const toInput = (t: TaxRate): TaxRateInput => ({ id: t.id, rate_ppm: t.rate_ppm, inclusive: t.inclusive });

/** Validates the form; `body` is set when it can be sent (`createInvoice` / `updateInvoice`). */
export function checkDraft(f: DraftForm, c: Catalogue, now = Math.floor(Date.now() / 1000)): Checked {
  const errors: { -readonly [K in keyof FormErrors]: FormErrors[K] } = {};
  const lineErrors: Record<
    string,
    Partial<Record<"price" | "description" | "amount" | "quantity" | "tax", string>>
  > = {};
  if (!f.customer) errors.customer = "Choose the customer to bill.";
  const decimals = pricingDecimals(f.currency, f.assetId || null, c.assets);
  if (f.currency === "asset" && !f.assetId) errors.currency = "Choose the asset to bill in.";
  let due: number | undefined;
  if (f.dueDate) {
    due = dueDateFromInput(f.dueDate);
    if (due === undefined) errors.dueDate = "Enter a valid date.";
    else if (due <= now) errors.dueDate = "Choose a date in the future.";
  }
  const reminders = parseReminderDays(f.reminders);
  if (!reminders.ok) errors.reminders = reminders.error;
  if (f.lines.length === 0) errors.lines = "Add at least one line.";
  if (f.lines.length > 100) errors.lines = "Use at most 100 lines.";

  const rateOf = (ids: readonly string[]) =>
    ids.map((id) => c.taxRates.get(id)).filter((t): t is TaxRate => t !== undefined);
  const preview: PreviewLine[] = [];
  const lines: LineBody[] = [];
  for (const l of f.lines) {
    const e: Partial<Record<"price" | "description" | "amount" | "quantity" | "tax", string>> = {};
    const qty = /^\d{1,7}$/.test(l.quantity.trim()) ? Number(l.quantity.trim()) : 0;
    if (qty < 1 || qty > 1_000_000) e.quantity = "Enter a quantity from 1 to 1,000,000.";
    const taxIds = l.taxRates ?? f.defaultTaxRates;
    const rates = rateOf(taxIds);
    if (taxIds.length > 5) e.tax = "Use at most 5 tax rates per line.";
    else if (rates.some((r) => r.inclusive !== rates[0]?.inclusive))
      e.tax = "A line can't mix inclusive and exclusive tax rates.";
    const explicit = l.taxRates === null ? {} : { tax_rates: [...l.taxRates] };
    let unit = 0n;
    if (l.price) {
      const p = c.prices.get(l.price);
      if (!p) e.price = "This price isn't available. Choose another.";
      else if (p.currency !== f.currency || (p.currency === "asset" && p.asset_id !== f.assetId))
        e.price = "This price uses another currency.";
      else unit = BigInt(p.unit_amount);
      lines.push({
        price: l.price,
        quantity: qty || 1,
        ...(l.description.trim() ? { description: l.description.trim() } : {}),
        ...explicit,
      });
    } else {
      if (!l.description.trim()) e.description = "Describe the line.";
      else if (l.description.trim().length > 500) e.description = "Use at most 500 characters.";
      const a = parseAmount(l.amount, f.currency, decimals, { allowZero: true });
      if (!a.ok) e.amount = a.error;
      else unit = a.units;
      lines.push({
        unit_amount: a.ok ? a.amount : 0,
        description: l.description.trim(),
        quantity: qty || 1,
        ...explicit,
      });
    }
    preview.push({ unitAmount: unit, quantity: qty || 1, taxRates: e.tax ? [] : rates.map(toInput) });
    if (Object.keys(e).length) lineErrors[l.key] = e;
  }
  if (Object.keys(lineErrors).length) errors.line = lineErrors;
  if (f.memo.trim().length > 1000) errors.memo = "Use at most 1,000 characters.";
  if (f.footer.trim().length > 1000) errors.footer = "Use at most 1,000 characters.";
  const ok = Object.keys(errors).length === 0;
  return {
    errors,
    preview,
    body: ok
      ? {
          customer: f.customer,
          currency: f.currency,
          ...(f.currency === "asset" ? { asset_id: f.assetId } : {}),
          lines,
          default_tax_rates: [...f.defaultTaxRates],
          ...(f.memo.trim() ? { description: f.memo.trim() } : {}),
          ...(f.footer.trim() ? { footer: f.footer.trim() } : {}),
          ...(due !== undefined ? { due_date: due } : {}),
          reminder_days: reminders.ok ? reminders.days : [],
        }
      : undefined,
  };
}

/** PATCH body for a draft: cleared memo/footer/due date are sent as `null`; `lines` replaces all. */
export function updateBody(b: DraftBody) {
  return {
    ...b,
    description: b.description ?? null,
    footer: b.footer ?? null,
    due_date: b.due_date ?? null,
    asset_id: b.asset_id ?? null,
  };
}

/** Actions the invoice status allows (spec routes' state rules; the server stays the authority). */
export function invoiceActions(i: Pick<Invoice, "status">) {
  return {
    edit: i.status === "draft",
    remove: i.status === "draft",
    finalize: i.status === "draft",
    send: i.status === "open" || i.status === "uncollectible",
    void: i.status === "open",
    uncollectible: i.status === "open",
    link: i.status === "open" || i.status === "uncollectible",
    pdf: i.status !== "draft",
  };
}

export interface ActivityEntry {
  readonly id: string;
  readonly at: number;
  readonly title: string;
  readonly body?: string;
  readonly state: "done" | "pending" | "attention" | "info";
}

const EVENT_COPY: Readonly<Record<string, [string, ActivityEntry["state"], string?]>> = {
  "invoice.created": ["Draft created", "info"],
  "invoice.finalized": ["Invoice finalized", "done", "Number, due date and payment page assigned."],
  "invoice.sent": ["Emailed to the customer", "done"],
  "invoice.payment_failed": [
    "Payment attempt failed",
    "attention",
    "The invoice stays open; the customer can pay again.",
  ],
  "invoice.overdue": ["Past due", "attention", "The due date passed without payment."],
  "invoice.paid": ["Paid", "done", "Settlement verified."],
  "invoice.voided": ["Voided", "info", "The payment page no longer accepts payments."],
  "invoice.marked_uncollectible": ["Marked uncollectible", "attention", "Reminders stopped; the page stays payable."],
};

/**
 * Activity of an invoice, newest first: its public events (every `invoice.sent` shows up, so repeated
 * sends are visible) plus the status transitions the events no longer cover (events are kept 30 days).
 */
export function invoiceActivity(
  inv: Pick<Invoice, "id" | "created" | "status_transitions" | "uncollectible_reason">,
  events: readonly { id: string; type: string; created: number }[],
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const copy = EVENT_COPY[e.type];
    if (!copy) continue;
    seen.add(e.type);
    const body =
      e.type === "invoice.marked_uncollectible" && inv.uncollectible_reason === "dunning_exhausted"
        ? "Unpaid after the last reminder."
        : copy[2];
    out.push({ id: e.id, at: e.created, title: copy[0], state: copy[1], ...(body ? { body } : {}) });
  }
  const t = inv.status_transitions;
  const fallback: [string, number | null][] = [
    ["invoice.created", inv.created],
    ["invoice.finalized", t.finalized_at],
    ["invoice.sent", t.sent_at],
    ["invoice.paid", t.paid_at],
    ["invoice.voided", t.voided_at],
    ["invoice.marked_uncollectible", t.marked_uncollectible_at],
  ];
  for (const [type, at] of fallback) {
    if (at === null || seen.has(type)) continue;
    const copy = EVENT_COPY[type] as [string, ActivityEntry["state"], string?];
    out.push({ id: `t:${type}`, at, title: copy[0], state: copy[1], ...(copy[2] ? { body: copy[2] } : {}) });
  }
  // same second: later events first (event ids grow with time; transitions sort after events)
  return out.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}
