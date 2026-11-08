import { describe, expect, it } from "vitest";
import {
  checkSubscription,
  dunningText,
  emptySubscription,
  newItem,
  nextInvoiceText,
  subscriptionActions,
  upcomingRenewal,
} from "./logic";

const p = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    product: "prod_1",
    active: true,
    type: "recurring",
    unit_amount: 4900,
    currency: "usd",
    asset_id: null,
    recurring: { interval: "month", interval_count: 1 },
    ...over,
  }) as never;
const prices = new Map([
  ["price_pro", p("price_pro")],
  ["price_seat", p("price_seat", { unit_amount: 1000 })],
  ["price_year", p("price_year", { recurring: { interval: "year", interval_count: 1 } })],
  ["price_eur", p("price_eur", { currency: "eur" })],
  ["price_once", p("price_once", { recurring: null, type: "one_time" })],
]);
const rates = new Map([
  ["txr_vat", { id: "txr_vat", rate_ppm: 190_000, inclusive: false } as never],
  ["txr_incl", { id: "txr_incl", rate_ppm: 70_000, inclusive: true } as never],
]);

describe("checkSubscription", () => {
  it("builds the body and the per-period preview", () => {
    const r = checkSubscription(
      {
        ...emptySubscription(),
        customer: "cus_1",
        items: [newItem({ price: "price_pro" }), newItem({ price: "price_seat", quantity: "3", taxRates: [] })],
        defaultTaxRates: ["txr_vat"],
        trialDays: "14",
        onExhausted: "unpaid",
        description: " Pro plan ",
      },
      prices,
      rates,
    );
    expect(r.body).toEqual({
      customer: "cus_1",
      items: [
        { price: "price_pro", quantity: 1 },
        { price: "price_seat", quantity: 3, tax_rates: [] },
      ],
      days_until_due: 7,
      trial_period_days: 14,
      default_tax_rates: ["txr_vat"],
      dunning: { reminder_days: [-3, 0, 1, 3, 7], on_exhausted: "unpaid" },
      description: "Pro plan",
    });
    expect(r.preview.ok && [r.preview.totals.subtotal, r.preview.totals.tax, r.preview.totals.total]).toEqual([
      7900n,
      931n,
      8831n,
    ]);
    expect(r.schedule).toEqual({ interval: "month", interval_count: 1 });
  });
  it("refuses mixed currencies, periods, one-time prices and bad numbers", () => {
    const r = checkSubscription(
      {
        ...emptySubscription(),
        items: [
          newItem({ key: "a", price: "price_pro" }),
          newItem({ key: "b", price: "price_eur" }),
          newItem({ key: "c", price: "price_year" }),
          newItem({ key: "d", price: "price_once", quantity: "0" }),
          newItem({ key: "e", price: "", taxRates: ["txr_vat", "txr_incl"] }),
        ],
        trialDays: "999",
        daysUntilDue: "91",
        reminders: "x",
        description: "y".repeat(501),
      },
      prices,
      rates,
    );
    expect(r.body).toBeUndefined();
    expect(r.errors.customer).toBeDefined();
    expect(r.errors.item?.b?.price).toBe("All prices must use the same currency.");
    expect(r.errors.item?.c?.price).toBe("All prices must bill every month.");
    expect(r.errors.item?.d).toEqual({ quantity: expect.any(String), price: "Subscriptions need a recurring price." });
    expect(r.errors.item?.e).toEqual({ price: "Choose a recurring price.", tax: expect.any(String) });
    expect([r.errors.trialDays, r.errors.daysUntilDue, r.errors.reminders, r.errors.description].every(Boolean)).toBe(
      true,
    );
    expect(checkSubscription({ ...emptySubscription(), items: [] }, prices, rates).errors.items).toBeDefined();
  });
});

describe("upcoming renewal and actions", () => {
  const anchor = Date.UTC(2026, 0, 31) / 1000;
  const sub = {
    status: "active",
    cancel_at_period_end: false,
    items: [{ price: { unit_amount: 4900 }, quantity: 2, tax_rates: null }],
    default_tax_rates: ["txr_vat", "txr_missing"],
    billing_cycle_anchor: anchor,
    current_period_end: Date.UTC(2026, 1, 28) / 1000,
    recurring: { interval: "month", interval_count: 1 },
    trial_end: null,
  } as never;
  it("estimates the next period's invoice", () => {
    const r = upcomingRenewal(sub, rates);
    expect(r?.start).toBe(Date.UTC(2026, 1, 28) / 1000);
    expect(r?.end).toBe(Date.UTC(2026, 2, 31) / 1000);
    expect(r?.ratesMissing).toBe(true);
    expect(r?.preview.ok && r.preview.totals.total).toBe(11662n);
  });
  it("no renewal when canceling, canceled, unpaid or incomplete", () => {
    for (const over of [
      { cancel_at_period_end: true },
      { status: "canceled" },
      { status: "unpaid" },
      { status: "incomplete" },
    ])
      expect(upcomingRenewal({ ...(sub as object), ...over } as never, rates)).toBeUndefined();
    expect(upcomingRenewal({ ...(sub as object), current_period_end: anchor + 5 } as never, rates)).toBeUndefined();
  });
  it("actions and texts", () => {
    expect(subscriptionActions({ status: "active", cancel_at_period_end: false })).toEqual({
      cancelNow: true,
      cancelAtPeriodEnd: true,
      undoCancel: false,
    });
    expect(subscriptionActions({ status: "active", cancel_at_period_end: true })).toEqual({
      cancelNow: true,
      cancelAtPeriodEnd: false,
      undoCancel: true,
    });
    expect(subscriptionActions({ status: "canceled", cancel_at_period_end: false })).toEqual({
      cancelNow: false,
      cancelAtPeriodEnd: false,
      undoCancel: false,
    });
    const fmt = (n: number) => `d${n}`;
    const base = { status: "active", cancel_at_period_end: false, current_period_end: 5, trial_end: null } as never as {
      status: "active" | "canceled" | "unpaid" | "incomplete" | "trialing";
      cancel_at_period_end: boolean;
      current_period_end: number;
      trial_end: number | null;
    };
    expect(nextInvoiceText(base, fmt)).toBe("d5");
    expect(nextInvoiceText({ ...base, cancel_at_period_end: true }, fmt)).toBe("Cancels d5");
    expect(nextInvoiceText({ ...base, status: "canceled" }, fmt)).toBe("—");
    expect(nextInvoiceText({ ...base, status: "unpaid" }, fmt)).toBe("Paused until paid");
    expect(nextInvoiceText({ ...base, status: "incomplete" }, fmt)).toBe("After the first payment");
    expect(nextInvoiceText({ ...base, status: "trialing", trial_end: 9 }, fmt)).toBe("d9");
    expect(dunningText({ reminder_days: [0], on_exhausted: "cancel" })).toContain("subscription is canceled");
    expect(dunningText({ reminder_days: [], on_exhausted: "unpaid" })).toMatch(/^No reminders; .*Unpaid/);
  });
});
