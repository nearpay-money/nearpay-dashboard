/**
 * E2E mock of the Stage 3 routes (billing catalogue, invoices, subscriptions, CLI login, events stream)
 * as a feature extension of test/e2e/mock-api.ts. Requests are still checked by MockApi (session, CSRF,
 * roles, step-up, request schemas) and JSON responses validated against the spec. Totals use the spec's
 * normative `computeInvoiceTotals`. Test-only.
 */
import { randomBytes } from "node:crypto";
import { API_VERSION, computeInvoiceTotals, Event, periodBoundary, type Role } from "@nearpay/spec";
import { intent, NOW, newId } from "../../../test/e2e/fixtures";
import { CustomersMock, installFeatureMock, type MockCtx, type Reply } from "../customers/customers.mock";

type Mode = "test" | "live";
type Obj = Record<string, unknown>;
type RawReply = Reply & { raw?: { contentType: string; body: string | Buffer; headers?: Record<string, string> } };

const ok = (body: unknown, status = 200): Reply => ({ status, body });
const fail = (status: number, code: string, type = "invalid_request_error", message = code): Reply => ({
  status,
  body: { error: { type, code, message, request_id: newId("req") } },
});
const list = (url: string, data: unknown[]) => ({ object: "list", data, has_more: false, url });
const now = () => Math.floor(Date.now() / 1000);
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const secret32 = () => [...randomBytes(32)].map((b) => B62[b % 62]).join("");

interface LineIn {
  price?: string;
  unit_amount?: number | string;
  description?: string;
  quantity?: number;
  tax_rates?: string[];
}

interface InvState {
  id: string;
  mode: Mode;
  created: number;
  status: string;
  number: string | null;
  customer: string;
  subscription: string | null;
  billing_reason: string;
  currency: string;
  asset_id: string | null;
  description: string | null;
  footer: string | null;
  lines: LineIn[];
  default_tax_rates: string[];
  days_until_due: number | null;
  due_date: number | null;
  reminder_days: number[];
  reminders_sent: number;
  finalized_at: number | null;
  sent_at: number | null;
  paid_at: number | null;
  voided_at: number | null;
  marked_uncollectible_at: number | null;
  uncollectible_reason: string | null;
  payment_intent: string | null;
  payment_intents: string[];
  period: { start: number; end: number } | null;
  secret: string;
  metadata: Obj;
  sequence: number;
  /** Stage 4 (spec 0.4.0): `auto_debit` invoices, `mandate`, `mandate_collection`. */
  collection_method?: string;
  extra?: Obj;
}

export interface CliLoginState {
  code: string;
  status: "pending" | "approved" | "denied" | "expired" | "redeemed";
  device_name: string;
  created: number;
  expires_at: number;
  /** Requested from another account → 404 for this one. */
  otherAccount?: boolean;
  key?: string;
}

export class BillingMock {
  readonly customers = new CustomersMock();
  readonly products: Record<Mode, Obj[]> = { test: [], live: [] };
  readonly prices: Record<Mode, Obj[]> = { test: [], live: [] };
  readonly taxRates: Record<Mode, Obj[]> = { test: [], live: [] };
  readonly invoices: Record<Mode, InvState[]> = { test: [], live: [] };
  readonly subscriptions: Record<Mode, Obj[]> = { test: [], live: [] };
  readonly cliLogins = new Map<string, CliLoginState>();
  /** Events created by billing actions (also pushed into MockApi's event log). */
  private readonly events: { test: Obj[]; live: Obj[] };
  private readonly intents: Record<Mode, Obj[]>;
  private seqNo = 0;
  /** First no-cursor stream connect per mode: later no-cursor connects deliver events after it (live tail). */
  tailWatermark: Partial<Record<Mode, string>> = {};
  /** Stage 4 hook: the mandates mock releases a mandate when its subscription leaves auto-debit. */
  onRelease?: (mode: Mode, mandate: string) => void;
  /** `retry:` the mock stream announces (short, to keep tests fast). */
  streamRetryMs = 300;

  constructor(api: object) {
    const a = api as { events: { test: Obj[]; live: Obj[] }; intents: Record<Mode, Obj[]> };
    this.events = a.events;
    this.intents = a.intents;
    installFeatureMock(api, this);
  }

  // ------------------------------------------------------------------ seeds
  product(mode: Mode, over: Obj = {}): Obj {
    const p = {
      id: newId("prod"),
      object: "product",
      created: NOW - 20 * 86_400,
      updated: NOW - 20 * 86_400,
      livemode: mode === "live",
      name: "Acme Team plan",
      description: null,
      active: true,
      metadata: {},
      ...over,
    };
    this.products[mode].push(p);
    return p;
  }
  price(mode: Mode, product: string, over: Obj = {}): Obj {
    const p = {
      id: newId("price"),
      object: "price",
      created: NOW - 20 * 86_400,
      livemode: mode === "live",
      product,
      active: true,
      type: "one_time",
      unit_amount: 24900,
      currency: "usd",
      asset_id: null,
      recurring: null,
      nickname: null,
      metadata: {},
      ...over,
    };
    if (p.recurring) p.type = "recurring";
    this.prices[mode].unshift(p);
    return p;
  }
  taxRate(mode: Mode, over: Obj = {}): Obj {
    const pct = String(over.percentage ?? "19");
    const [i, f = ""] = pct.split(".");
    const t = {
      id: newId("txr"),
      object: "tax_rate",
      created: NOW - 30 * 86_400,
      livemode: mode === "live",
      display_name: "VAT",
      description: null,
      jurisdiction: null,
      country: null,
      percentage: pct,
      rate_ppm: Number(i) * 10_000 + Number(f.padEnd(4, "0")),
      inclusive: false,
      active: true,
      metadata: {},
      ...over,
    };
    this.taxRates[mode].unshift(t);
    return t;
  }
  invoice(mode: Mode, over: Partial<InvState> = {}): InvState {
    const id = newId("in");
    const inv: InvState = {
      id,
      mode,
      created: NOW - 5 * 86_400,
      status: "draft",
      number: null,
      customer: "",
      subscription: null,
      billing_reason: "manual",
      currency: "usd",
      asset_id: null,
      description: null,
      footer: null,
      lines: [],
      default_tax_rates: [],
      days_until_due: 30,
      due_date: null,
      reminder_days: [-3, 0, 1, 3, 7],
      reminders_sent: 0,
      finalized_at: null,
      sent_at: null,
      paid_at: null,
      voided_at: null,
      marked_uncollectible_at: null,
      uncollectible_reason: null,
      payment_intent: null,
      payment_intents: [],
      period: null,
      secret: `${id}_secret_${secret32()}`,
      metadata: {},
      sequence: 0,
      ...over,
    };
    this.invoices[mode].unshift(inv);
    return inv;
  }
  /** Marks an invoice paid by a verified payment (what billing does on `payment_intent.succeeded`). */
  pay(mode: Mode, inv: InvState): void {
    const r = this.render(inv);
    const pi = intent({
      amount: r.total as never,
      currency: inv.currency,
      source: "invoice" as never,
      description: `Invoice ${inv.number}`,
      ...({ invoice: inv.id } as Obj),
    });
    this.intents[mode].unshift(pi as Obj);
    inv.status = "paid";
    inv.paid_at = now();
    inv.payment_intent = pi.id;
    inv.payment_intents.unshift(pi.id);
    this.emit(mode, "invoice.paid", inv);
  }

  // ------------------------------------------------------------------ rendering
  private nextNumber(mode: Mode) {
    this.seqNo++;
    return `ACMECO${mode === "live" ? "L" : "T"}-${String(2040 + this.seqNo).padStart(5, "0")}`;
  }
  private findPrice(mode: Mode, id?: string) {
    return this.prices[mode].find((p) => p.id === id);
  }
  private amt(currency: string, v: bigint): number | string {
    return currency === "asset" ? v.toString() : Number(v);
  }
  render(inv: InvState): Obj {
    const mode = inv.mode;
    const lines = inv.lines.map((l, i) => {
      const p = this.findPrice(mode, l.price);
      const unit = BigInt((p?.unit_amount as number | string | undefined) ?? l.unit_amount ?? 0);
      const qty = l.quantity ?? 1;
      const taxIds = l.tax_rates ?? inv.default_tax_rates;
      const rates = taxIds.map((id) => this.taxRates[mode].find((t) => t.id === id)).filter(Boolean) as Obj[];
      const product = p ? this.products[mode].find((x) => x.id === p.product) : undefined;
      return { l, i, unit, qty, rates, p, product, taxIds };
    });
    const totals = computeInvoiceTotals(
      lines.map((x) => ({
        amount: x.unit * BigInt(x.qty),
        tax_rates: x.rates.map((r) => ({
          id: r.id as string,
          rate_ppm: r.rate_ppm as number,
          inclusive: r.inclusive as boolean,
        })),
      })),
    );
    const c = inv.currency;
    const taxAmount = (t: { tax_rate: string; inclusive: boolean; amount: bigint; taxable_amount: bigint }) => {
      const r = this.taxRates[mode].find((x) => x.id === t.tax_rate) as Obj;
      return {
        tax_rate: t.tax_rate,
        display_name: r.display_name,
        percentage: r.percentage,
        inclusive: t.inclusive,
        amount: this.amt(c, t.amount),
        taxable_amount: this.amt(c, t.taxable_amount),
      };
    };
    const open = inv.status !== "draft";
    const total = totals.total;
    const paid = inv.status === "paid" ? total : 0n;
    const nextReminder =
      (inv.status === "open" && inv.due_date
        ? inv.reminder_days.map((d) => (inv.due_date as number) + d * 86_400).find((t) => t > now())
        : undefined) ?? null;
    return {
      id: inv.id,
      object: "invoice",
      created: inv.created,
      livemode: mode === "live",
      status: inv.status,
      number: inv.number,
      customer: inv.customer,
      subscription: inv.subscription,
      billing_reason: inv.billing_reason,
      collection_method: inv.collection_method ?? "send_invoice",
      currency: c,
      asset_id: inv.asset_id,
      description: inv.description,
      footer: inv.footer,
      lines: lines.map((x, i) => {
        const lt = totals.lines[i] as (typeof totals.lines)[number];
        const incl = lt.taxes.filter((t) => t.inclusive).reduce((s, t) => s + t.amount, 0n);
        return {
          id: `il_01jbz9k3m4n5p6q7r8s9t0${String(i).padStart(4, "0")}`,
          object: "line_item",
          type: inv.subscription ? "subscription" : "invoiceitem",
          price: x.p ? x.p.id : null,
          product: x.p ? x.p.product : null,
          subscription_item: null,
          description: x.l.description ?? (x.product?.name as string | undefined) ?? "Item",
          quantity: x.qty,
          unit_amount: this.amt(c, x.unit),
          amount: this.amt(c, lt.amount),
          amount_excluding_tax: this.amt(c, lt.amount - incl),
          tax_rates: x.taxIds,
          tax_amounts: lt.taxes.map(taxAmount),
          period: inv.period,
        };
      }),
      default_tax_rates: inv.default_tax_rates,
      subtotal: this.amt(c, totals.subtotal),
      tax: this.amt(c, totals.tax),
      total: this.amt(c, total),
      total_excluding_tax: this.amt(c, totals.total_excluding_tax),
      total_tax_amounts: totals.total_tax_amounts.map(taxAmount),
      amount_due: this.amt(c, total),
      amount_paid: this.amt(c, paid),
      amount_remaining: this.amt(c, total - paid),
      days_until_due: inv.days_until_due,
      due_date: inv.due_date,
      period_start: inv.period?.start ?? null,
      period_end: inv.period?.end ?? null,
      settlement_destination: null,
      reminder_days: inv.reminder_days,
      reminders_sent: inv.reminders_sent,
      next_reminder_at: nextReminder,
      hosted_invoice_url: open ? `https://pay.nearpay.localhost/i/${inv.id}#${inv.secret}` : null,
      invoice_pdf: open ? `https://api.nearpay.localhost/v1/invoices/${inv.id}/pdf` : null,
      checkout_session: null,
      payment_intent: inv.payment_intent,
      payment_intents: inv.payment_intents,
      status_transitions: {
        finalized_at: inv.finalized_at,
        sent_at: inv.sent_at,
        paid_at: inv.paid_at,
        voided_at: inv.voided_at,
        marked_uncollectible_at: inv.marked_uncollectible_at,
      },
      uncollectible_reason: inv.uncollectible_reason,
      metadata: inv.metadata,
      sequence: inv.sequence,
      ...(inv.extra ?? {}),
    };
  }

  private emit(mode: Mode, type: string, inv: InvState | Obj) {
    if ("mode" in inv && "secret" in inv) (inv as InvState).sequence++;
    const object = "secret" in inv ? { ...this.render(inv as InvState), hosted_invoice_url: null } : inv;
    const e = Event.parse({
      id: newId("evt"),
      object: "event",
      type,
      api_version: API_VERSION,
      created: now(),
      livemode: mode === "live",
      data: { object },
      request: { id: null, idempotency_key: null },
    }) as unknown as Obj;
    this.events[mode].unshift(e);
    return e;
  }

  private finalize(inv: InvState): Reply | undefined {
    const r = this.render(inv);
    if (inv.lines.length === 0 || BigInt(r.total as number) <= 0n) return fail(400, "invoice_empty");
    const c = this.customers.customers[inv.mode].find((x) => x.id === inv.customer);
    if (!c) return fail(400, "customer_deleted");
    inv.status = "open";
    inv.number = this.nextNumber(inv.mode);
    inv.finalized_at = now();
    if (inv.due_date === null) inv.due_date = now() + (inv.days_until_due ?? 30) * 86_400;
    this.emit(inv.mode, "invoice.finalized", inv);
    return undefined;
  }

  // ------------------------------------------------------------------ routes
  handle(c: MockCtx & { headers?: Record<string, string> }): RawReply | undefined {
    const m = c.mode;
    const own = this.billing(c, m);
    return own ?? this.customers.handle(c);
  }

  private billing(c: MockCtx & { headers?: Record<string, string> }, m: Mode): RawReply | undefined {
    const b = c.body ?? {};
    const byId = <T extends { id?: unknown }>(xs: T[]) => xs.find((x) => x.id === c.params.id);
    switch (c.routeId) {
      // ---- catalogue
      case "listProducts": {
        const a = c.query.active;
        return ok(
          list(
            "/v1/products",
            this.products[m].filter((p) => a === undefined || String(p.active) === a),
          ),
        );
      }
      case "getProduct": {
        const p = byId(this.products[m]);
        return p ? ok(p) : fail(404, "resource_missing");
      }
      case "createProduct":
        return ok(this.product(m, { created: now(), updated: now(), description: null, ...b }), 201);
      case "updateProduct": {
        const p = byId(this.products[m]);
        if (!p) return fail(404, "resource_missing");
        Object.assign(p, b, { updated: now() });
        return ok(p);
      }
      case "listPrices": {
        const q = c.query;
        return ok(
          list(
            "/v1/prices",
            this.prices[m].filter(
              (p) =>
                (q.active === undefined || String(p.active) === q.active) &&
                (!q.product || p.product === q.product) &&
                (!q.type || p.type === q.type),
            ),
          ),
        );
      }
      case "getPrice": {
        const p = byId(this.prices[m]);
        return p ? ok(p) : fail(404, "resource_missing");
      }
      case "createPrice": {
        const recurring = b.recurring
          ? { interval: b.recurring.interval, interval_count: b.recurring.interval_count ?? 1 }
          : null;
        return ok(
          this.price(m, b.product, {
            created: now(),
            unit_amount: b.unit_amount,
            currency: b.currency,
            asset_id: b.asset_id ?? null,
            recurring,
            nickname: b.nickname ?? null,
          }),
          201,
        );
      }
      case "updatePrice": {
        const p = byId(this.prices[m]);
        if (!p) return fail(404, "resource_missing");
        Object.assign(p, b);
        return ok(p);
      }
      case "listTaxRates": {
        const a = c.query.active;
        return ok(
          list(
            "/v1/tax_rates",
            this.taxRates[m].filter((t) => a === undefined || String(t.active) === a),
          ),
        );
      }
      case "getTaxRate": {
        const t = byId(this.taxRates[m]);
        return t ? ok(t) : fail(404, "resource_missing");
      }
      case "createTaxRate":
        return ok(this.taxRate(m, { created: now(), ...b }), 201);
      case "updateTaxRate": {
        const t = byId(this.taxRates[m]);
        if (!t) return fail(404, "resource_missing");
        Object.assign(t, b);
        return ok(t);
      }

      // ---- invoices
      case "listInvoices": {
        const q = c.query;
        const lte = q["due_date[lte]"] !== undefined ? Number(q["due_date[lte]"]) : undefined;
        return ok(
          list(
            "/v1/invoices",
            this.invoices[m]
              .filter(
                (i) =>
                  (!q.status || i.status === q.status) &&
                  (!q.customer || i.customer === q.customer) &&
                  (!q.subscription || i.subscription === q.subscription) &&
                  (lte === undefined || (i.due_date !== null && i.due_date <= lte)),
              )
              .map((i) => this.render(i)),
          ),
        );
      }
      case "getInvoice": {
        const i = byId(this.invoices[m]);
        return i ? ok(this.render(i)) : fail(404, "resource_missing");
      }
      case "createInvoice": {
        const first = (b.lines ?? []).map((l: LineIn) => this.findPrice(m, l.price)).find(Boolean) as Obj | undefined;
        const inv = this.invoice(m, {
          created: now(),
          customer: b.customer,
          currency: b.currency ?? (first?.currency as string | undefined) ?? "usd",
          asset_id: b.asset_id ?? null,
          lines: b.lines ?? [],
          default_tax_rates: b.default_tax_rates ?? [],
          description: b.description ?? null,
          footer: b.footer ?? null,
          due_date: b.due_date ?? null,
          days_until_due: b.due_date ? null : (b.days_until_due ?? 30),
          reminder_days: b.reminder_days ?? [-3, 0, 1, 3, 7],
        });
        this.emit(m, "invoice.created", inv);
        return ok(this.render(inv), 201);
      }
      case "updateInvoice": {
        const i = byId(this.invoices[m]);
        if (!i) return fail(404, "resource_missing");
        if (i.status !== "draft") return fail(409, "state_conflict");
        if (b.customer !== undefined) i.customer = b.customer;
        if (b.currency !== undefined) i.currency = b.currency;
        if (b.asset_id !== undefined) i.asset_id = b.asset_id;
        if (b.lines !== undefined) i.lines = b.lines;
        if (b.default_tax_rates !== undefined) i.default_tax_rates = b.default_tax_rates;
        if (b.description !== undefined) i.description = b.description;
        if (b.footer !== undefined) i.footer = b.footer;
        if (b.due_date !== undefined) i.due_date = b.due_date;
        if (b.reminder_days !== undefined) i.reminder_days = b.reminder_days;
        i.sequence++;
        return ok(this.render(i));
      }
      case "deleteInvoice": {
        const i = byId(this.invoices[m]);
        if (!i) return fail(404, "resource_missing");
        if (i.status !== "draft") return fail(409, "state_conflict");
        this.invoices[m].splice(this.invoices[m].indexOf(i), 1);
        return ok({ id: i.id, object: "invoice", livemode: m === "live", deleted: true });
      }
      case "finalizeInvoice": {
        const i = byId(this.invoices[m]);
        if (!i) return fail(404, "resource_missing");
        if (i.status !== "draft") return fail(409, "state_conflict");
        return this.finalize(i) ?? ok(this.render(i));
      }
      case "sendInvoice": {
        const i = byId(this.invoices[m]);
        if (!i) return fail(404, "resource_missing");
        if (i.status !== "open" && i.status !== "uncollectible") return fail(409, "state_conflict");
        if (i.sent_at !== null && now() - i.sent_at < 600) return fail(429, "rate_limited", "rate_limit_error");
        const cust = this.customers.customers[m].find((x) => x.id === i.customer);
        if (!cust?.email) return fail(400, "customer_email_missing");
        i.sent_at = now();
        this.emit(m, "invoice.sent", i);
        return ok(this.render(i));
      }
      case "voidInvoice": {
        const i = byId(this.invoices[m]);
        if (!i) return fail(404, "resource_missing");
        if (i.status !== "open") return fail(409, "state_conflict");
        i.status = "void";
        i.voided_at = now();
        this.emit(m, "invoice.voided", i);
        return ok(this.render(i));
      }
      case "markInvoiceUncollectible": {
        const i = byId(this.invoices[m]);
        if (!i) return fail(404, "resource_missing");
        if (i.status !== "open") return fail(409, "state_conflict");
        i.status = "uncollectible";
        i.uncollectible_reason = "merchant";
        i.marked_uncollectible_at = now();
        this.emit(m, "invoice.marked_uncollectible", i);
        return ok(this.render(i));
      }
      case "getInvoicePdf": {
        const i = byId(this.invoices[m]);
        if (!i) return fail(404, "resource_missing");
        if (i.status === "draft") return fail(409, "state_conflict");
        return {
          status: 200,
          raw: {
            contentType: "application/pdf",
            body: Buffer.from(`%PDF-1.7\n% ${i.number}\n%%EOF\n`),
            headers: {
              "content-disposition": `attachment; filename="${i.number}.pdf"`,
              "cache-control": "private, no-store",
            },
          },
        };
      }
      case "listPaymentIntents": {
        if (!c.query.invoice) return undefined;
        return ok(
          list(
            "/v1/payment_intents",
            this.intents[m].filter((p) => p.invoice === c.query.invoice),
          ),
        );
      }

      // ---- subscriptions
      case "listSubscriptions": {
        const q = c.query;
        return ok(
          list(
            "/v1/subscriptions",
            this.subscriptions[m].filter(
              (s) => (!q.status || s.status === q.status) && (!q.customer || s.customer === q.customer),
            ),
          ),
        );
      }
      case "getSubscription": {
        const s = byId(this.subscriptions[m]);
        return s ? ok(s) : fail(404, "resource_missing");
      }
      case "createSubscription": {
        const cust = this.customers.customers[m].find((x) => x.id === b.customer);
        if (!cust) return fail(400, "customer_deleted");
        if (!cust.email) return fail(400, "customer_email_missing");
        const items = (b.items as LineIn[]).map((it, i) => ({
          id: `si_01jbz9k3m4n5p6q7r8s9t0${String(i).padStart(4, "0")}`,
          object: "subscription_item",
          price: this.findPrice(m, it.price),
          quantity: it.quantity ?? 1,
          tax_rates: it.tax_rates ?? null,
        }));
        const p0 = items[0]?.price as Obj;
        const rec = p0.recurring as { interval: "month"; interval_count: number };
        const trialEnd = b.trial_period_days ? now() + b.trial_period_days * 86_400 : null;
        const anchor = trialEnd ?? now();
        const sub: Obj = this.subscription(m, {
          created: now(),
          customer: b.customer,
          status: trialEnd ? "trialing" : "incomplete",
          items,
          currency: p0.currency,
          asset_id: p0.asset_id,
          recurring: rec,
          billing_cycle_anchor: anchor,
          current_period_start: trialEnd ? now() : anchor,
          current_period_end: trialEnd ?? periodBoundary(anchor, rec.interval, rec.interval_count, 1),
          days_until_due: b.days_until_due ?? 7,
          default_tax_rates: b.default_tax_rates ?? [],
          dunning: {
            reminder_days: b.dunning?.reminder_days ?? [-3, 0, 1, 3, 7],
            on_exhausted: b.dunning?.on_exhausted ?? "cancel",
          },
          trial_start: trialEnd ? now() : null,
          trial_end: trialEnd,
          description: b.description ?? null,
          collection_method: b.collection_method ?? "send_invoice",
        });
        if (!trialEnd) {
          const inv = this.invoice(m, {
            created: now(),
            customer: b.customer,
            subscription: sub.id as string,
            billing_reason: "subscription_create",
            currency: p0.currency as string,
            lines: (b.items as LineIn[]).map((it) => ({
              price: it.price,
              quantity: it.quantity,
              tax_rates: it.tax_rates,
            })),
            default_tax_rates: b.default_tax_rates ?? [],
            days_until_due: b.days_until_due ?? 7,
            period: { start: sub.current_period_start as number, end: sub.current_period_end as number },
          });
          this.finalize(inv);
          inv.sent_at = now();
          this.emit(m, "invoice.sent", inv);
          sub.latest_invoice = inv.id;
        }
        return ok(sub, 201);
      }
      case "cancelSubscription": {
        const s = byId(this.subscriptions[m]);
        if (!s) return fail(404, "resource_missing");
        if (s.status === "canceled") return fail(409, "state_conflict");
        s.canceled_at = now();
        s.cancellation_reason = "requested";
        if (b.at_period_end) s.cancel_at_period_end = true;
        else {
          s.status = "canceled";
          s.ended_at = now();
        }
        (s.sequence as number)++;
        return ok(s);
      }
      case "updateSubscription": {
        const s = byId(this.subscriptions[m]);
        if (!s) return fail(404, "resource_missing");
        if (s.status === "canceled") return fail(409, "state_conflict");
        if (b.cancel_at_period_end === false) {
          s.cancel_at_period_end = false;
          s.canceled_at = null;
          s.cancellation_reason = null;
        }
        // stage 4 (billing §14 d6): leaving auto_debit releases the linked mandate
        if (b.collection_method) {
          s.collection_method = b.collection_method;
          if (b.collection_method === "send_invoice" && s.mandate) {
            this.onRelease?.(m, s.mandate as string);
            s.mandate = null;
          }
        }
        (s.sequence as number)++;
        return ok(s);
      }

      // ---- CLI login (identity)
      case "getCliLogin": {
        const l = this.cliLogins.get(c.params.code ?? "");
        if (!l || l.otherAccount) return fail(404, "resource_missing");
        return ok(this.cliView(l));
      }
      case "approveCliLogin":
      case "denyCliLogin": {
        const l = this.cliLogins.get(c.params.code ?? "");
        if (!l || l.otherAccount) return fail(404, "resource_missing");
        if (l.status !== "pending" || l.expires_at <= now()) return fail(409, "state_conflict");
        if (c.routeId === "approveCliLogin") {
          l.status = "approved";
          l.key = newId("key");
        } else l.status = "denied";
        return ok(this.cliView(l));
      }

      // ---- events stream (webhooks)
      case "streamEvents":
        return this.stream(m, c);
      default:
        return undefined;
    }
  }

  subscription(mode: Mode, over: Obj = {}): Obj {
    const anchor = NOW - 40 * 86_400;
    const s = {
      id: newId("sub"),
      object: "subscription",
      created: NOW - 40 * 86_400,
      livemode: mode === "live",
      customer: "",
      status: "active",
      collection_method: "send_invoice",
      items: [],
      currency: "usd",
      asset_id: null,
      recurring: { interval: "month", interval_count: 1 },
      billing_cycle_anchor: anchor,
      current_period_start: periodBoundary(anchor, "month", 1, 1),
      current_period_end: periodBoundary(anchor, "month", 1, 2),
      days_until_due: 7,
      default_tax_rates: [],
      dunning: { reminder_days: [-3, 0, 1, 3, 7], on_exhausted: "cancel" },
      trial_start: null,
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      cancellation_reason: null,
      latest_invoice: null,
      settlement_destination: null,
      description: null,
      metadata: {},
      sequence: 1,
      ...over,
    };
    this.subscriptions[mode].unshift(s);
    return s;
  }

  cliLogin(over: Partial<CliLoginState> = {}): CliLoginState {
    const l: CliLoginState = {
      code: "BCDF-GHJK",
      status: "pending",
      device_name: "adarsh-mbp",
      created: now() - 40,
      expires_at: now() + 860,
      ...over,
    };
    this.cliLogins.set(l.code, l);
    return l;
  }
  private cliView(l: CliLoginState) {
    return {
      object: "cli_login_request",
      user_code: l.code,
      device_name: l.device_name,
      status: l.status,
      created: l.created,
      expires_at: l.expires_at,
      requested_from: {
        ip: "203.0.113.24",
        country: "IN",
        user_agent: "nearpay-cli/0.3.0 (darwin arm64; node 22.11.0)",
      },
      account: l.status === "approved" || l.status === "redeemed" ? "acct_01jbz9k3m4n5p6q7r8s9t0v1w2" : null,
      key: l.key ?? null,
    };
  }

  /** One SSE response: `ready`, then the events after the cursor (or the live watermark), then close. */
  private stream(m: Mode, c: MockCtx & { headers?: Record<string, string> }): RawReply {
    const cursor = c.headers?.["last-event-id"] ?? (c.query.starting_after as string | undefined);
    const types = typeof c.query.types === "string" && c.query.types !== "*" ? c.query.types.split(",") : undefined;
    const asc = [...this.events[m]].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let after = cursor;
    if (!after) {
      if (this.tailWatermark[m] === undefined) this.tailWatermark[m] = String(asc.at(-1)?.id ?? "evt_0");
      after = this.tailWatermark[m];
    }
    const send = asc.filter((e) => String(e.id) > String(after) && (!types || types.includes(String(e.type))));
    const ready = {
      object: "event_stream",
      livemode: m === "live",
      account: "acct_01jbz9k3m4n5p6q7r8s9t0v1w2",
      types: types ?? ["*"],
      resumed_after: cursor ?? null,
      expires_at: now() + 3600,
    };
    const body = [
      `retry: ${this.streamRetryMs}`,
      "",
      "event: ready",
      `data: ${JSON.stringify(ready)}`,
      "",
      ": heartbeat",
      "",
      ...send.flatMap((e) => [`id: ${e.id}`, "event: event", `data: ${JSON.stringify(e)}`, ""]),
      "",
    ].join("\n");
    return { status: 200, raw: { contentType: "text/event-stream", body, headers: { "cache-control": "no-store" } } };
  }

  /** Adds a public event (for the live tail tests). */
  push(mode: Mode, type: string, object: Obj): Obj {
    return this.emit(mode, type, object);
  }
}

export type { Role };
