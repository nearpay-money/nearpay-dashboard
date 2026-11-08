/**
 * Create / edit a draft invoice (Figma b02 "Create invoice"): customer, currency, due date, items
 * (one-time prices or custom amounts, quantity, per-line tax), default tax rates, note to customer,
 * reminders; the "Invoice summary" card previews the totals with the spec's normative tax arithmetic
 * and offers "Finalize & get link" / "Save draft". The first save creates the draft; later saves
 * update the same draft (no duplicates when finalizing fails and the user retries).
 */
import { createInvoice, finalizeInvoice, type Invoice, type Price, type TaxRate, updateInvoice } from "@nearpay/spec";
import {
  Button,
  Card,
  CardTitle,
  Checkbox,
  CloseIcon,
  Field,
  IconButton,
  Input,
  KeyValueList,
  MenuButton,
  Select,
  Textarea,
} from "@nearpay-internal/ui";
import { useMemo, useState } from "react";
import { Link, useApp } from "../../app/context";
import { amountText, BILLING_CURRENCIES, percentText, previewTotals, pricingDecimals } from "../../lib/billing";
import { ApiError } from "../../lib/errors";
import { roleAllows } from "../../lib/permissions";
import { ErrorState, LoadingState, Page } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import { useActivePrices, useActiveTaxRates, useCustomerOptions, useProductNames } from "../billing/shared";
import "../billing/billing.css";
import { useInvoice } from "./api";
import { checkDraft, type DraftForm, type DraftLine, emptyForm, formFromInvoice, newLine, updateBody } from "./logic";

export function InvoiceEditor({ id }: { id?: string }) {
  const app = useApp();
  const existing = useInvoice(id);
  const prices = useActivePrices("one_time");
  const rates = useActiveTaxRates();
  const customers = useCustomerOptions();
  const title = id ? "Edit draft invoice" : "Create invoice";
  if (id && existing.loading && !existing.data) return <LoadingState what="Loading invoice" />;
  if (id && (existing.error || !existing.data))
    return <ErrorState title={title} error={existing.error} onRetry={existing.reload} />;
  if (id && existing.data && existing.data.status !== "draft")
    return (
      <Page title={title}>
        <ErrorNote error={new Error("Only drafts can be edited. Finalized invoices are fixed documents.")} />
        <Link to={`/billing/invoices/${id}`}>Back to the invoice</Link>
      </Page>
    );
  if ((prices.loading && !prices.data) || (rates.loading && !rates.data) || (customers.loading && !customers.data))
    return <LoadingState what="Loading your catalogue" />;
  const loadError = prices.error ?? rates.error ?? customers.error;
  if (loadError)
    return (
      <ErrorState
        title={title}
        error={loadError}
        onRetry={() => {
          prices.reload();
          rates.reload();
          customers.reload();
        }}
      />
    );
  return (
    <InvoiceFormView
      title={title}
      invoice={id ? existing.data : undefined}
      prices={prices.data ?? []}
      taxRates={rates.data ?? []}
      customers={customers.data?.customers ?? []}
      moreCustomers={customers.data?.more ?? false}
      assets={app.assets}
    />
  );
}

interface ViewProps {
  title: string;
  invoice: Invoice | undefined;
  prices: readonly Price[];
  taxRates: readonly TaxRate[];
  customers: readonly { id: string; name: string | null; email: string | null }[];
  moreCustomers: boolean;
  assets: ReturnType<typeof useApp>["assets"];
}

function InvoiceFormView({ title, invoice, prices, taxRates, customers, moreCustomers, assets }: ViewProps) {
  const app = useApp();
  const [form, setForm] = useState<DraftForm>(() => {
    if (invoice) return formFromInvoice(invoice, assets);
    const pre = new URLSearchParams(app.location.search).get("customer") ?? "";
    return { ...emptyForm(), customer: customers.some((c) => c.id === pre) ? pre : "" };
  });
  const [savedId, setSavedId] = useState<string | undefined>(invoice?.id);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"save" | "finalize">();
  const [error, setError] = useState<unknown>();
  const productNames = useProductNames(prices.map((p) => p.product));
  const catalogue = useMemo(
    () => ({
      prices: new Map<string, Price>(prices.map((p) => [p.id, p])),
      taxRates: new Map<string, TaxRate>(taxRates.map((t) => [t.id, t])),
      assets,
    }),
    [prices, taxRates, assets],
  );
  const checked = checkDraft(form, catalogue);
  const shown = touched ? checked.errors : {};
  const set = (patch: Partial<DraftForm>) => setForm((f) => ({ ...f, ...patch }));
  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const money = (units: bigint) =>
    amountText({ amount: units, currency: form.currency, asset_id: form.assetId || null }, assets);
  const decimals = pricingDecimals(form.currency, form.assetId || null, assets);
  const currencyPrices = prices.filter(
    (p) => p.currency === form.currency && (p.currency !== "asset" || p.asset_id === form.assetId),
  );
  const hasPriceLines = form.lines.some((l) => l.price);
  const finalizeBlocked = app.gate(finalizeInvoice);
  const canFinalize = roleAllows(finalizeInvoice, app.session?.role);

  const submit = async (finalize: boolean) => {
    setTouched(true);
    if (!checked.body) return;
    setBusy(finalize ? "finalize" : "save");
    setError(undefined);
    try {
      let id = savedId;
      if (id) await app.api.call(updateInvoice, { params: { id }, body: updateBody(checked.body) });
      else {
        const created = await app.api.call(createInvoice, { body: checked.body });
        id = created.id;
        setSavedId(id);
      }
      if (finalize) await app.api.call(finalizeInvoice, { params: { id }, body: {} });
      app.navigate(app.href(`/billing/invoices/${id}${finalize ? "?finalized=1" : ""}`));
    } catch (e) {
      setError(e);
      setBusy(undefined);
    }
  };

  // the spec's normative arithmetic (computeInvoiceTotals): per-line tax, round half-up (INV-5)
  const preview = previewTotals(checked.preview);
  const totals = preview.ok
    ? {
        subtotal: preview.totals.subtotal,
        total: preview.totals.total,
        taxes: preview.totals.total_tax_amounts.map((t) => ({ id: t.tax_rate, amount: t.amount })),
      }
    : undefined;
  const rateName = (id: string) => {
    const t = catalogue.taxRates.get(id);
    return t ? `${t.display_name} ${percentText(t.percentage)}${t.inclusive ? " (included)" : ""}` : id;
  };

  return (
    <Page
      title={title}
      subtitle="Prepare an invoice and share its payment page."
      back={{ label: "Billing", to: "/billing" }}
    >
      <form
        className="npf-billing__form-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
        aria-label={title}
      >
        <div className="np-stack np-stack--lg npf-billing__form-main">
          <Field
            label="Customer"
            error={shown.customer}
            hint={
              <>
                {moreCustomers ? "Showing your 100 newest customers. " : ""}
                <Link to="/customers">Add a customer</Link> if they're not listed.
              </>
            }
          >
            <Select
              value={form.customer}
              onChange={(e) => set({ customer: e.target.value })}
              placeholder="Choose a customer"
              data-testid="invoice-customer"
              options={customers.map((c) => ({
                value: c.id,
                label: [c.name, c.email].filter(Boolean).join(" · ") || c.id,
              }))}
            />
          </Field>
          <div className="npf-billing__row-2">
            <Field
              label="Currency"
              error={shown.currency}
              hint={hasPriceLines ? "Set by the prices on this invoice." : undefined}
            >
              <Select
                value={form.currency}
                disabled={hasPriceLines}
                onChange={(e) => set({ currency: e.target.value, assetId: "" })}
                data-testid="invoice-currency"
                options={[...BILLING_CURRENCIES, { value: "asset", label: "Crypto asset" }]}
              />
            </Field>
            {form.currency === "asset" ? (
              <Field label="Asset">
                <Select
                  value={form.assetId}
                  disabled={hasPriceLines}
                  placeholder="Choose an asset"
                  onChange={(e) => set({ assetId: e.target.value })}
                  options={[...assets.entries()].map(([id, a]) => ({
                    value: id,
                    label: `${a.symbol}${a.chain ? ` · ${a.chain}` : ""}`,
                  }))}
                />
              </Field>
            ) : (
              <Field label="Due date" error={shown.dueDate} hint="Leave empty: due 30 days after you finalize.">
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => set({ dueDate: e.target.value })}
                  data-testid="invoice-due"
                />
              </Field>
            )}
          </div>
          {form.currency === "asset" ? (
            <Field label="Due date" error={shown.dueDate} hint="Leave empty: due 30 days after you finalize.">
              <Input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
            </Field>
          ) : null}

          <fieldset className="npf-billing__items" aria-describedby={shown.lines ? "npf-lines-error" : undefined}>
            <legend className="np-text-h4">Items</legend>
            {shown.lines ? (
              <p id="npf-lines-error" className="npf-billing__error" role="alert">
                {shown.lines}
              </p>
            ) : null}
            {form.lines.map((l, i) => {
              const e = shown.line?.[l.key] ?? {};
              const price = l.price ? catalogue.prices.get(l.price) : undefined;
              const lineTotal = checked.preview[i]
                ? checked.preview[i].unitAmount * BigInt(checked.preview[i].quantity)
                : 0n;
              const taxIds = l.taxRates ?? form.defaultTaxRates;
              return (
                <div key={l.key} className="npf-billing__item" data-testid="invoice-line">
                  <div className="npf-billing__item-head">
                    <span className="np-text-small np-text-secondary">Item {i + 1}</span>
                    <IconButton
                      label={`Remove item ${i + 1}`}
                      icon={<CloseIcon size={18} />}
                      onClick={() => set({ lines: form.lines.filter((x) => x.key !== l.key) })}
                    />
                  </div>
                  <div className="npf-billing__item-grid">
                    <Field label="Product or amount" error={e.price}>
                      <Select
                        value={l.price}
                        onChange={(ev) => setLine(l.key, { price: ev.target.value, amount: "" })}
                        data-testid="line-price"
                        options={[
                          { value: "", label: "Custom amount" },
                          ...currencyPrices.map((p) => ({
                            value: p.id,
                            label: `${productNames.get(p.product) ?? "Product"} · ${amountText({ amount: p.unit_amount, currency: p.currency, asset_id: p.asset_id }, assets)}${p.nickname ? ` · ${p.nickname}` : ""}`,
                          })),
                        ]}
                      />
                    </Field>
                    <Field
                      label="Description"
                      error={e.description}
                      hint={price ? "Optional: replaces the product name." : undefined}
                    >
                      <Input
                        value={l.description}
                        maxLength={500}
                        placeholder={price ? (productNames.get(price.product) ?? "") : "Consulting, March"}
                        onChange={(ev) => setLine(l.key, { description: ev.target.value })}
                        data-testid="line-description"
                      />
                    </Field>
                    <Field label="Qty" error={e.quantity}>
                      <Input
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(ev) => setLine(l.key, { quantity: ev.target.value })}
                        data-testid="line-quantity"
                        numeric
                      />
                    </Field>
                    <Field label="Unit price" error={e.amount}>
                      {price ? (
                        <Input
                          value={amountText(
                            { amount: price.unit_amount, currency: price.currency, asset_id: price.asset_id },
                            assets,
                          )}
                          readOnly
                          numeric
                        />
                      ) : (
                        <Input
                          inputMode="decimal"
                          value={l.amount}
                          placeholder={decimals ? `0.${"0".repeat(Math.min(decimals, 2))}` : "0"}
                          onChange={(ev) => setLine(l.key, { amount: ev.target.value })}
                          data-testid="line-amount"
                          numeric
                        />
                      )}
                    </Field>
                  </div>
                  <div className="npf-billing__item-foot">
                    <MenuButton
                      label={`Tax rates for item ${i + 1}`}
                      selectable="multiple"
                      variant="select"
                      active={l.taxRates !== null}
                      items={[
                        { id: "__default", label: "Use invoice default", checked: l.taxRates === null },
                        { separator: true, id: "sep" },
                        ...taxRates.map((t) => ({
                          id: t.id,
                          label: `${t.display_name} ${percentText(t.percentage)}${t.inclusive ? " incl." : ""}`,
                          checked: taxIds.includes(t.id),
                        })),
                      ]}
                      onSelect={(id) => {
                        if (id === "__default") return setLine(l.key, { taxRates: null });
                        const cur = l.taxRates ?? form.defaultTaxRates;
                        setLine(l.key, { taxRates: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
                      }}
                      data-testid="line-tax"
                    >
                      <span className="np-select-button__label">Tax:</span>
                      <span className="np-select-button__value">
                        {taxIds.length === 0 ? "None" : taxIds.map(rateName).join(", ")}
                        {l.taxRates === null && taxIds.length ? " (default)" : ""}
                      </span>
                    </MenuButton>
                    <span className="npf-billing__item-amount">
                      <span className="np-sr-only">Item {i + 1} amount: </span>
                      {money(lineTotal)}
                    </span>
                  </div>
                  {e.tax ? (
                    <p className="npf-billing__error" role="alert">
                      {e.tax}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => set({ lines: [...form.lines, newLine()] })}
                disabled={form.lines.length >= 100}
                data-testid="add-line"
              >
                Add line item
              </Button>
            </div>
          </fieldset>

          {taxRates.length ? (
            <fieldset className="npf-billing__checks">
              <legend className="np-text-small">Default tax rates</legend>
              <p className="np-text-small np-text-secondary">Applied to items without their own tax rates.</p>
              {taxRates.map((t) => (
                <Checkbox
                  key={t.id}
                  label={`${t.display_name} ${percentText(t.percentage)}`}
                  description={`${t.inclusive ? "Included in prices" : "Added on top"}${t.jurisdiction ? ` · ${t.jurisdiction}` : ""}`}
                  checked={form.defaultTaxRates.includes(t.id)}
                  onChange={(e) =>
                    set({
                      defaultTaxRates: e.target.checked
                        ? [...form.defaultTaxRates, t.id]
                        : form.defaultTaxRates.filter((x) => x !== t.id),
                    })
                  }
                />
              ))}
            </fieldset>
          ) : (
            <p className="np-text-small np-text-secondary">
              No tax rates yet. <Link to="/billing/tax-rates">Add a tax rate</Link> to charge tax.
            </p>
          )}

          <Field label="Note to customer" error={shown.memo} hint="Shown on the invoice and its payment page.">
            <Textarea
              value={form.memo}
              maxLength={1000}
              rows={3}
              placeholder="Thank you for your business."
              onChange={(e) => set({ memo: e.target.value })}
              data-testid="invoice-memo"
            />
          </Field>
          <details className="npf-billing__more">
            <summary>More options</summary>
            <div className="np-stack">
              <Field label="Footer" error={shown.footer} hint="Small print at the bottom of the invoice.">
                <Textarea
                  value={form.footer}
                  maxLength={1000}
                  rows={2}
                  onChange={(e) => set({ footer: e.target.value })}
                />
              </Field>
              <Field
                label="Reminder schedule"
                error={shown.reminders}
                hint="Days relative to the due date: negative before, 0 on the day. Leave empty for no reminders."
              >
                <Input
                  value={form.reminders}
                  onChange={(e) => set({ reminders: e.target.value })}
                  data-testid="invoice-reminders"
                />
              </Field>
            </div>
          </details>
        </div>

        <aside className="npf-billing__aside" aria-label="Invoice summary">
          <Card>
            <div className="np-stack">
              <CardTitle as="h2">Invoice summary</CardTitle>
              <KeyValueList
                items={
                  totals
                    ? [
                        { label: "Subtotal", value: money(totals.subtotal) },
                        ...(totals.taxes.length
                          ? totals.taxes.map((t) => ({ label: rateName(t.id), value: money(t.amount) }))
                          : [{ label: "Tax", value: money(0n) }]),
                        { label: "Amount due", value: money(totals.total), total: true },
                      ]
                    : [{ label: "Amount due", value: money(0n), total: true }]
                }
              />
              <p className="np-text-caption np-text-secondary">Payment fees are shown to the payer at checkout.</p>
              {error ? <FormError error={error} saved={Boolean(savedId)} /> : null}
              {touched && !checked.body ? (
                <p className="npf-billing__error" role="alert">
                  Check the highlighted fields.
                </p>
              ) : null}
              {canFinalize ? (
                <Button
                  type="submit"
                  fullWidth
                  loading={busy === "finalize"}
                  loadingText="Finalizing…"
                  disabled={busy !== undefined || finalizeBlocked !== null}
                  title={finalizeBlocked ?? undefined}
                  data-testid="finalize-and-link"
                >
                  Finalize &amp; get link
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                fullWidth
                loading={busy === "save"}
                loadingText="Saving…"
                disabled={busy !== undefined}
                onClick={() => void submit(false)}
                data-testid="save-draft"
              >
                Save draft
              </Button>
              {finalizeBlocked ? <p className="np-text-caption np-text-secondary">{finalizeBlocked}</p> : null}
            </div>
          </Card>
        </aside>
      </form>
    </Page>
  );
}

function FormError({ error, saved }: { error: unknown; saved: boolean }) {
  return (
    <div className="np-stack np-stack--sm">
      <ErrorNote error={error} />
      {saved && error instanceof ApiError ? (
        <p className="np-text-caption np-text-secondary">Your draft is saved. Fix the problem and try again.</p>
      ) : null}
    </div>
  );
}
