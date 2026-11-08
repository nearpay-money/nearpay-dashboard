import { describe, expect, it } from "vitest";
import { checkDraft, emptyForm, formFromInvoice, invoiceActions, invoiceActivity, newLine, updateBody } from "./logic";

const USDC = "nep141:usdc.near";
const assets = new Map([[USDC, { symbol: "USDC", decimals: 6 }]]);
const price = (over: Record<string, unknown> = {}) =>
  ({
    id: "price_team",
    object: "price",
    created: 1,
    livemode: false,
    product: "prod_team",
    active: true,
    type: "one_time",
    unit_amount: 24900,
    currency: "usd",
    asset_id: null,
    recurring: null,
    nickname: null,
    metadata: {},
    ...over,
  }) as never;
const rate = (id: string, ppm: number, inclusive: boolean) =>
  ({ id, display_name: id, percentage: String(ppm / 10_000), rate_ppm: ppm, inclusive, active: true }) as never;
const cat = {
  prices: new Map([
    ["price_team", price()],
    ["price_eur", price({ id: "price_eur", currency: "eur" })],
  ]),
  taxRates: new Map([
    ["txr_vat", rate("txr_vat", 190_000, false)],
    ["txr_incl", rate("txr_incl", 70_000, true)],
  ]),
  assets,
};
const NOW = 1_800_000_000;

describe("checkDraft", () => {
  it("builds the createInvoice body: price + custom lines, default and per-line tax", () => {
    const f = {
      ...emptyForm(NOW * 1000),
      customer: "cus_1",
      dueDate: "",
      defaultTaxRates: ["txr_vat"],
      memo: " Thanks ",
      lines: [
        newLine({ key: "a", price: "price_team" }),
        newLine({ key: "b", description: "Setup", amount: "100.50", quantity: "2", taxRates: [] }),
      ],
    };
    const r = checkDraft(f, cat, NOW);
    expect(r.errors).toEqual({});
    expect(r.body).toEqual({
      customer: "cus_1",
      currency: "usd",
      lines: [
        { price: "price_team", quantity: 1 },
        { unit_amount: 10050, description: "Setup", quantity: 2, tax_rates: [] },
      ],
      default_tax_rates: ["txr_vat"],
      description: "Thanks",
      reminder_days: [-3, 0, 1, 3, 7],
    });
    // preview: 249.00 + 19% = 47.31 tax; 201.00 untaxed
    expect(r.preview.map((p) => [p.unitAmount, p.quantity, p.taxRates.length])).toEqual([
      [24900n, 1, 1],
      [10050n, 2, 0],
    ]);
  });
  it("reports field errors and withholds the body", () => {
    const f = {
      ...emptyForm(NOW * 1000),
      dueDate: "2020-01-01",
      reminders: "3,1",
      memo: "x".repeat(1001),
      lines: [
        newLine({ key: "a", price: "price_eur", quantity: "0" }),
        newLine({ key: "b", description: "", amount: "1.234" }),
        newLine({ key: "c", description: "Mixed", amount: "1", taxRates: ["txr_vat", "txr_incl"] }),
        newLine({ key: "d", price: "price_gone" }),
      ],
    };
    const r = checkDraft(f, cat, NOW);
    expect(r.body).toBeUndefined();
    expect(r.errors.customer).toBeDefined();
    expect(r.errors.dueDate).toBe("Choose a date in the future.");
    expect(r.errors.reminders).toBeDefined();
    expect(r.errors.memo).toBeDefined();
    expect(r.errors.line?.a).toEqual({ quantity: expect.any(String), price: "This price uses another currency." });
    expect(r.errors.line?.b).toEqual({ description: "Describe the line.", amount: "Use at most 2 decimals." });
    expect(r.errors.line?.c?.tax).toBe("A line can't mix inclusive and exclusive tax rates.");
    expect(r.errors.line?.d?.price).toBeDefined();
  });
  it("asset invoices need the asset; bad dates and empty lines are caught", () => {
    const r = checkDraft(
      { ...emptyForm(NOW * 1000), customer: "cus_1", currency: "asset", dueDate: "nope", lines: [] },
      cat,
      NOW,
    );
    expect(r.errors.currency).toBe("Choose the asset to bill in.");
    expect(r.errors.dueDate).toBe("Enter a valid date.");
    expect(r.errors.lines).toBe("Add at least one line.");
    const ok = checkDraft(
      {
        ...emptyForm(NOW * 1000),
        customer: "cus_1",
        currency: "asset",
        assetId: USDC,
        lines: [newLine({ description: "API", amount: "2.5" })],
      },
      cat,
      NOW,
    );
    expect(ok.body?.asset_id).toBe(USDC);
    expect(ok.body?.lines[0]).toEqual({ unit_amount: "2500000", description: "API", quantity: 1 });
    expect(ok.body?.due_date).toBeGreaterThan(NOW);
  });
  it("updateBody clears memo, footer, due date and asset with null", () => {
    expect(
      updateBody({ customer: "cus_1", currency: "usd", lines: [], default_tax_rates: [], reminder_days: [] }),
    ).toMatchObject({
      description: null,
      footer: null,
      due_date: null,
      asset_id: null,
    });
  });
  it("formFromInvoice round-trips a draft", () => {
    const f = formFromInvoice(
      {
        customer: "cus_1",
        currency: "usd",
        asset_id: null,
        due_date: null,
        default_tax_rates: ["txr_vat"],
        description: null,
        footer: "fine print",
        reminder_days: [0, 7],
        lines: [
          { price: "price_team", description: "Team", unit_amount: 24900, quantity: 1, tax_rates: ["txr_vat"] },
          { price: null, description: "Setup", unit_amount: 5, quantity: 3, tax_rates: [] },
        ],
      } as never,
      assets,
    );
    expect(f.lines.map((l) => [l.price, l.description, l.amount, l.quantity, l.taxRates])).toEqual([
      ["price_team", "", "", "1", null],
      ["", "Setup", "0.05", "3", []],
    ]);
    expect(f.reminders).toBe("0, 7");
    expect(f.footer).toBe("fine print");
  });
});

describe("invoice actions and activity", () => {
  it("allows actions by status", () => {
    expect(invoiceActions({ status: "draft" })).toMatchObject({ edit: true, finalize: true, send: false, pdf: false });
    expect(invoiceActions({ status: "open" })).toMatchObject({
      send: true,
      void: true,
      uncollectible: true,
      link: true,
      pdf: true,
    });
    expect(invoiceActions({ status: "uncollectible" })).toMatchObject({ send: true, void: false, link: true });
    expect(invoiceActions({ status: "paid" })).toMatchObject({ send: false, void: false, link: false, pdf: true });
  });
  it("merges events with status transitions, newest first", () => {
    const a = invoiceActivity(
      {
        id: "in_1",
        created: 100,
        uncollectible_reason: "dunning_exhausted",
        status_transitions: {
          finalized_at: 200,
          sent_at: 400,
          paid_at: null,
          voided_at: null,
          marked_uncollectible_at: 500,
        },
      },
      [
        { id: "evt_2", type: "invoice.sent", created: 300 },
        { id: "evt_3", type: "invoice.sent", created: 400 },
        { id: "evt_4", type: "invoice.marked_uncollectible", created: 500 },
        { id: "evt_x", type: "invoice.reminder", created: 450 },
      ],
    );
    expect(a.map((x) => [x.title, x.at])).toEqual([
      ["Marked uncollectible", 500],
      ["Emailed to the customer", 400],
      ["Emailed to the customer", 300],
      ["Invoice finalized", 200],
      ["Draft created", 100],
    ]);
    expect(a[0]?.body).toBe("Unpaid after the last reminder.");
  });
});
