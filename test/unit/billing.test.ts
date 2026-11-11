import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { taxPercentageToPpm } from "@nearpay-money/spec";
import { describe, expect, it } from "vitest";
import {
  amountText,
  dateInputValue,
  dueDateFromInput,
  dunningState,
  durationText,
  intervalText,
  isPastDue,
  nextPeriod,
  parseAmount,
  parseReminderDays,
  parseTaxPercentage,
  percentText,
  perIntervalText,
  previewTotals,
  priceSummary,
  pricingDecimals,
  reminderDaysText,
  sendCooldown,
  summarizeAmounts,
  taxRateLabel,
  unitsToInput,
} from "../../src/lib/billing";

const require = createRequire(import.meta.url);
const USDC = "nep141:usdc.near";
const assets = new Map([[USDC, { symbol: "USDC", decimals: 6 }]]);

describe("billing amounts (INV-5)", () => {
  it("formats fiat, assets and unknown assets exactly", () => {
    expect(amountText({ amount: 4900, currency: "usd" }, assets)).toBe("$49.00");
    expect(amountText({ amount: 500n, currency: "jpy" }, assets)).toBe("¥500");
    expect(amountText({ amount: "2500000", currency: "asset", asset_id: USDC }, assets)).toBe("2.5 USDC");
    expect(amountText({ amount: "7", currency: "asset", asset_id: "nep141:x" }, assets)).toBe("7 base units");
    expect(amountText({ amount: "1", currency: "asset" }, assets)).toBe("1 base units");
  });
  it("pricingDecimals", () => {
    expect(pricingDecimals("usd", null, assets)).toBe(2);
    expect(pricingDecimals("jpy", null, assets)).toBe(0);
    expect(pricingDecimals("asset", USDC, assets)).toBe(6);
    expect(pricingDecimals("asset", null, assets)).toBeUndefined();
    expect(pricingDecimals("asset", "nep141:x", assets)).toBeUndefined();
  });
  it("parseAmount: exact decimals, fiat numbers, asset strings", () => {
    expect(parseAmount("49", "usd", 2)).toEqual({ ok: true, amount: 4900, units: 4900n });
    expect(parseAmount("1,249.5", "usd", 2)).toEqual({ ok: true, amount: 124950, units: 124950n });
    expect(parseAmount(".5", "usd", 2)).toEqual({ ok: true, amount: 50, units: 50n });
    expect(parseAmount("0.000001", "asset", 6)).toEqual({ ok: true, amount: "1", units: 1n });
    expect(parseAmount("1.001", "usd", 2)).toEqual({ ok: false, error: "Use at most 2 decimals." });
    expect(parseAmount("1.5", "jpy", 0)).toEqual({ ok: false, error: "This currency has no decimals." });
    expect(parseAmount("", "usd", 2).ok).toBe(false);
    expect(parseAmount(".", "usd", 2).ok).toBe(false);
    expect(parseAmount("abc", "usd", 2).ok).toBe(false);
    expect(parseAmount("0", "usd", 2)).toEqual({ ok: false, error: "Enter an amount above zero." });
    expect(parseAmount("0", "usd", 2, { allowZero: true })).toEqual({ ok: true, amount: 0, units: 0n });
    expect(parseAmount("1", "asset", undefined)).toEqual({ ok: false, error: "Choose the asset to price in." });
    expect(parseAmount("99999999999999999", "usd", 2)).toEqual({ ok: false, error: "That amount is too large." });
    expect(parseAmount("9".repeat(80), "asset", 0)).toEqual({ ok: false, error: "That amount is too large." });
    // never a float: 0.1 + 0.2 style values stay exact
    expect(parseAmount("0.30", "asset", 18)).toEqual({
      ok: true,
      amount: "300000000000000000",
      units: 3n * 10n ** 17n,
    });
  });
  it("unitsToInput", () => {
    expect(unitsToInput(4900, 2)).toBe("49.00");
    expect(unitsToInput("5", 2)).toBe("0.05");
    expect(unitsToInput(500n, 0)).toBe("500");
  });
  it("summarizeAmounts picks the most common currency and counts the others", () => {
    expect(summarizeAmounts([], assets)).toEqual({ text: "—", others: 0, count: 0 });
    const s = summarizeAmounts(
      [
        { amount: 4900, currency: "usd" },
        { amount: 100, currency: "usd" },
        { amount: "1000000", currency: "asset", asset_id: USDC },
      ],
      assets,
    );
    expect(s).toEqual({ text: "$50.00", others: 1, count: 2 });
    expect(summarizeAmounts([{ amount: "3", currency: "asset" }], assets).text).toBe("3 base units");
  });
});

describe("billing intervals and prices", () => {
  it("interval texts", () => {
    expect(intervalText({ interval: "month", interval_count: 1 })).toBe("month");
    expect(intervalText({ interval: "month", interval_count: 3 })).toBe("3 months");
    expect(perIntervalText({ interval: "year", interval_count: 1 })).toBe("/year");
    expect(perIntervalText({ interval: "week", interval_count: 2 })).toBe(" every 2 weeks");
  });
  it("priceSummary", () => {
    expect(
      priceSummary(
        { unit_amount: 24900, currency: "usd", asset_id: null, recurring: { interval: "month", interval_count: 1 } },
        assets,
      ),
    ).toBe("$249.00/month");
    expect(priceSummary({ unit_amount: 9900, currency: "usd", asset_id: null, recurring: null }, assets)).toBe(
      "$99.00 one-time",
    );
  });
});

describe("tax percentages are exact strings", () => {
  it("parseTaxPercentage normalises and validates without floats", () => {
    expect(parseTaxPercentage("8.875")).toBe("8.875");
    expect(parseTaxPercentage(" 19 % ")).toBe("19");
    expect(parseTaxPercentage("08.50")).toBe("8.5");
    expect(parseTaxPercentage("19.")).toBe("19");
    expect(parseTaxPercentage("0")).toBe("0");
    expect(parseTaxPercentage("100")).toBe("100");
    expect(parseTaxPercentage("100.0000")).toBe("100");
    expect(parseTaxPercentage("100.5")).toBeNull();
    expect(parseTaxPercentage("101")).toBeNull();
    expect(parseTaxPercentage("7.12345")).toBeNull();
    expect(parseTaxPercentage("-1")).toBeNull();
    expect(parseTaxPercentage("1e1")).toBeNull();
    expect(parseTaxPercentage("")).toBeNull();
    // round-trips through the spec ppm conversion exactly
    expect(taxPercentageToPpm(parseTaxPercentage("8.875") as string)).toBe(88_750);
    expect(taxPercentageToPpm(parseTaxPercentage("0.0001") as string)).toBe(1);
  });
  it("labels", () => {
    expect(percentText("8.875")).toBe("8.875%");
    expect(taxRateLabel({ display_name: "VAT", percentage: "19", inclusive: true, jurisdiction: "DE" })).toBe(
      "VAT (DE) · 19% · inclusive",
    );
    expect(taxRateLabel({ display_name: "Sales tax", percentage: "8.875", inclusive: false })).toBe(
      "Sales tax · 8.875% · exclusive",
    );
  });
});

describe("previewTotals matches the spec vectors", () => {
  const v = JSON.parse(readFileSync(require.resolve("@nearpay-money/spec/test-vectors/billing-tax.json"), "utf8")) as {
    tax_cases: {
      name: string;
      lines: { unit_amount: string; quantity: number; rates: string[] }[];
      tax_rates: { id: string; rate_ppm: number; inclusive: boolean }[];
      expected: { subtotal: string; tax: string; total: string } | { error: string };
    }[];
  };
  for (const c of v.tax_cases) {
    it(c.name, () => {
      const r = previewTotals(
        c.lines.map((l) => ({
          unitAmount: BigInt(l.unit_amount),
          quantity: l.quantity,
          taxRates: l.rates.map(
            (id) => c.tax_rates.find((t) => t.id === id) as { id: string; rate_ppm: number; inclusive: boolean },
          ),
        })),
      );
      if ("error" in c.expected) {
        expect(r.ok).toBe(false);
        return;
      }
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.totals.subtotal.toString()).toBe(c.expected.subtotal);
      expect(r.totals.tax.toString()).toBe(c.expected.tax);
      expect(r.totals.total.toString()).toBe(c.expected.total);
    });
  }
  it("refuses mixed inclusive/exclusive on one line", () => {
    const r = previewTotals([
      {
        unitAmount: 100n,
        quantity: 1,
        taxRates: [
          { id: "txr_a", rate_ppm: 1, inclusive: true },
          { id: "txr_b", rate_ppm: 1, inclusive: false },
        ],
      },
    ]);
    expect(r).toEqual({ ok: false, line: 0, error: "A line can't mix inclusive and exclusive tax rates." });
  });
});

describe("periods and dates", () => {
  const jan31 = Date.UTC(2026, 0, 31, 12) / 1000;
  it("nextPeriod follows periodBoundary from the anchor (month-end clamp)", () => {
    const feb28 = Date.UTC(2026, 1, 28, 12) / 1000;
    const mar31 = Date.UTC(2026, 2, 31, 12) / 1000;
    expect(
      nextPeriod({
        billing_cycle_anchor: jan31,
        current_period_end: feb28,
        recurring: { interval: "month", interval_count: 1 },
      }),
    ).toEqual({ start: feb28, end: mar31 });
    // trial: anchor = trial end = current period end → first period
    expect(
      nextPeriod({
        billing_cycle_anchor: jan31,
        current_period_end: jan31,
        recurring: { interval: "month", interval_count: 1 },
      }),
    ).toEqual({ start: jan31, end: feb28 });
    expect(
      nextPeriod({
        billing_cycle_anchor: jan31,
        current_period_end: jan31 + 7 * 86_400,
        recurring: { interval: "week", interval_count: 1 },
      })?.end,
    ).toBe(jan31 + 14 * 86_400);
    expect(
      nextPeriod({
        billing_cycle_anchor: jan31,
        current_period_end: jan31 + 5,
        recurring: { interval: "day", interval_count: 1 },
      }),
    ).toBeUndefined();
    expect(
      nextPeriod({
        billing_cycle_anchor: jan31,
        current_period_end: jan31 + 86_400,
        recurring: { interval: "fortnight", interval_count: 1 },
      }),
    ).toBeUndefined();
  });
  it("date inputs (local end of day)", () => {
    const due = dueDateFromInput("2026-11-12") as number;
    const d = new Date(due * 1000);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 12, 23, 59]);
    expect(dateInputValue(due)).toBe("2026-11-12");
    expect(dueDateFromInput("2026-02-30")).toBeUndefined();
    expect(dueDateFromInput("12/11/2026")).toBeUndefined();
  });
  it("reminders", () => {
    expect(reminderDaysText([])).toBe("No reminders");
    expect(reminderDaysText([-3, -1, 0, 1, 7])).toBe(
      "3 days before, 1 day before, on the due date, 1 day after, 7 days after",
    );
    expect(parseReminderDays("-3, 0, 1 3,7")).toEqual({ ok: true, days: [-3, 0, 1, 3, 7] });
    expect(parseReminderDays("")).toEqual({ ok: true, days: [] });
    expect(parseReminderDays("+2")).toEqual({ ok: true, days: [2] });
    expect(parseReminderDays("1,1").ok).toBe(false);
    expect(parseReminderDays("3,1").ok).toBe(false);
    expect(parseReminderDays("-31").ok).toBe(false);
    expect(parseReminderDays("61").ok).toBe(false);
    expect(parseReminderDays("1.5").ok).toBe(false);
    expect(parseReminderDays("0,1,2,3,4,5,6,7,8,9,10")).toEqual({ ok: false, error: "Use at most 10 reminders." });
  });
});

describe("invoice status helpers", () => {
  const inv = {
    status: "open",
    due_date: 1000,
    reminder_days: [-3, 0, 1],
    reminders_sent: 1,
    next_reminder_at: 2000,
    amount_remaining: 100,
  };
  it("isPastDue", () => {
    expect(isPastDue(inv, 1001)).toBe(true);
    expect(isPastDue(inv, 999)).toBe(false);
    expect(isPastDue({ status: "paid", due_date: 1 }, 5)).toBe(false);
    expect(isPastDue({ status: "open", due_date: null }, 5)).toBe(false);
  });
  it("dunningState", () => {
    expect(dunningState(inv)).toEqual({ kind: "scheduled", sent: 1, total: 3, next: 2000 });
    expect(dunningState({ ...inv, next_reminder_at: null, reminders_sent: 3 })).toEqual({
      kind: "exhausted",
      sent: 3,
      total: 3,
    });
    expect(dunningState({ ...inv, status: "uncollectible", next_reminder_at: null, reminders_sent: 0 })).toEqual({
      kind: "exhausted",
      sent: 0,
      total: 3,
    });
    expect(dunningState({ ...inv, next_reminder_at: null, reminders_sent: 0 })).toEqual({
      kind: "scheduled",
      sent: 0,
      total: 3,
      next: null,
    });
    expect(dunningState({ ...inv, status: "paid" })).toEqual({ kind: "none" });
    expect(dunningState({ ...inv, reminder_days: [] })).toEqual({ kind: "none" });
  });
  it("send cooldown (one email per 10 minutes)", () => {
    expect(sendCooldown(null, 100)).toBe(0);
    expect(sendCooldown(1000, 1100)).toBe(500);
    expect(sendCooldown(1000, 1700)).toBe(0);
    expect(durationText(581)).toBe("9 min 41 s");
    expect(durationText(41)).toBe("41 s");
  });
});
