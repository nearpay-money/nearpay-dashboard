/**
 * New subscription (lld/billing.md §5, §11 d9): customer, recurring prices (same currency and period),
 * quantities and tax, optional trial, invoice due days, dunning (reminder days + what happens when
 * they run out), invoice text. The summary previews the per-period total with the spec arithmetic and
 * says plainly how renewals are collected: an emailed invoice the customer pays, or (Stage 4, billing §14)
 * auto-debit from a vault mandate the customer funds and can cancel — with the eligibility of the chosen
 * prices explained (USD at par in USDC/USDT or an allowed NEP-141 token; an active NEAR Intents account).
 */
import type { Price, TaxRate } from "@nearpay/spec";
import { createSubscription } from "@nearpay/spec";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  Checkbox,
  CloseIcon,
  Field,
  IconButton,
  Input,
  KeyValueList,
  MenuButton,
  OptionCard,
  RadioCardGroup,
  Select,
  Textarea,
} from "@nearpay-internal/ui";
import { useMemo, useState } from "react";
import { Link, useApp } from "../../app/context";
import { FEATURE_STAGE } from "../../app/registry";
import { amountText, intervalText, percentText, priceSummary } from "../../lib/billing";
import { ErrorState, LoadingState, Page } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import "../billing/billing.css";
import { useActivePrices, useActiveTaxRates, useCustomerOptions, useProductNames } from "../billing/shared";
import { useActiveDestinations } from "../mandates/api";
import { autoDebitEligibility, type Eligibility } from "../mandates/logic";
import { checkSubscription, emptySubscription, type ItemRow, newItem, type SubscriptionForm } from "./logic";

export function NewSubscription() {
  const prices = useActivePrices("recurring");
  const rates = useActiveTaxRates();
  const customers = useCustomerOptions();
  if ((prices.loading && !prices.data) || (rates.loading && !rates.data) || (customers.loading && !customers.data))
    return <LoadingState what="Loading your catalogue" />;
  const err = prices.error ?? rates.error ?? customers.error;
  if (err)
    return (
      <ErrorState
        title="New subscription"
        error={err}
        onRetry={() => {
          prices.reload();
          rates.reload();
          customers.reload();
        }}
      />
    );
  return (
    <FormView prices={prices.data ?? []} taxRates={rates.data ?? []} customers={customers.data?.customers ?? []} />
  );
}

function FormView({
  prices,
  taxRates,
  customers,
}: {
  prices: readonly Price[];
  taxRates: readonly TaxRate[];
  customers: readonly { id: string; name: string | null; email: string | null }[];
}) {
  const app = useApp();
  const [form, setForm] = useState<SubscriptionForm>(() => {
    const pre = new URLSearchParams(app.location.search).get("customer") ?? "";
    return { ...emptySubscription(), customer: customers.some((c) => c.id === pre) ? pre : "" };
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const products = useProductNames(prices.map((p) => p.product));
  const priceIndex = useMemo(() => new Map<string, Price>(prices.map((p) => [p.id, p])), [prices]);
  const rateIndex = useMemo(() => new Map<string, TaxRate>(taxRates.map((t) => [t.id, t])), [taxRates]);
  const checked = checkSubscription(form, priceIndex, rateIndex);
  const shown = touched ? checked.errors : {};
  const set = (p: Partial<SubscriptionForm>) => setForm((f) => ({ ...f, ...p }));
  const setItem = (key: string, p: Partial<ItemRow>) =>
    setForm((f) => ({ ...f, items: f.items.map((i) => (i.key === key ? { ...i, ...p } : i)) }));
  const first = form.items.map((i) => priceIndex.get(i.price)).find(Boolean);
  const money = (u: bigint) =>
    first ? amountText({ amount: u, currency: first.currency, asset_id: first.asset_id }, app.assets) : "—";
  const blocked = app.gate(createSubscription);
  const trial = form.trialDays.trim() !== "" && !shown.trialDays;
  const autoDebit = form.collectionMethod === "auto_debit";

  const submit = async () => {
    setTouched(true);
    if (!checked.body) return;
    setBusy(true);
    setError(undefined);
    try {
      const s = await app.api.call(createSubscription, { body: checked.body });
      app.navigate(app.href(`/billing/subscriptions/${s.id}?created=1`));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const rateName = (id: string) => {
    const t = rateIndex.get(id);
    return t ? `${t.display_name} ${percentText(t.percentage)}` : id;
  };
  return (
    <Page
      title="New subscription"
      subtitle="Recurring billing with clear collection status."
      back={{ label: "Subscriptions", to: "/billing/subscriptions" }}
    >
      <form
        className="npf-billing__form-grid"
        noValidate
        aria-label="New subscription"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="np-stack np-stack--lg npf-billing__form-main">
          <Field
            label="Customer"
            error={shown.customer}
            hint="The customer needs an email address: renewal invoices are emailed."
          >
            <Select
              value={form.customer}
              placeholder="Choose a customer"
              onChange={(e) => set({ customer: e.target.value })}
              data-testid="subscription-customer"
              options={customers.map((c) => ({
                value: c.id,
                label: [c.name, c.email].filter(Boolean).join(" · ") || c.id,
              }))}
            />
          </Field>
          <fieldset className="npf-billing__items">
            <legend className="np-text-h4">Prices</legend>
            {prices.length === 0 ? (
              <p className="np-text-secondary">
                No recurring prices yet. <Link to="/billing/products">Add a product with a recurring price</Link> first.
              </p>
            ) : null}
            {shown.items ? (
              <p className="npf-billing__error" role="alert">
                {shown.items}
              </p>
            ) : null}
            {form.items.map((it, i) => {
              const e = shown.item?.[it.key] ?? {};
              const ids = it.taxRates ?? form.defaultTaxRates;
              return (
                <div key={it.key} className="npf-billing__item" data-testid="subscription-item">
                  <div className="npf-billing__item-head">
                    <span className="np-text-small np-text-secondary">Price {i + 1}</span>
                    <IconButton
                      label={`Remove price ${i + 1}`}
                      icon={<CloseIcon size={18} />}
                      onClick={() => set({ items: form.items.filter((x) => x.key !== it.key) })}
                    />
                  </div>
                  <div className="npf-billing__item-grid npf-billing__item-grid--sub">
                    <Field label="Recurring price" error={e.price}>
                      <Select
                        value={it.price}
                        placeholder="Choose a price"
                        onChange={(ev) => setItem(it.key, { price: ev.target.value })}
                        data-testid="item-price"
                        options={prices.map((p) => ({
                          value: p.id,
                          label: `${products.get(p.product) ?? "Product"} · ${priceSummary(p, app.assets)}${p.nickname ? ` · ${p.nickname}` : ""}`,
                        }))}
                      />
                    </Field>
                    <Field label="Qty" error={e.quantity}>
                      <Input
                        inputMode="numeric"
                        numeric
                        value={it.quantity}
                        onChange={(ev) => setItem(it.key, { quantity: ev.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="npf-billing__item-foot">
                    <MenuButton
                      label={`Tax rates for price ${i + 1}`}
                      selectable="multiple"
                      variant="select"
                      active={it.taxRates !== null}
                      items={[
                        { id: "__default", label: "Use subscription default", checked: it.taxRates === null },
                        { separator: true, id: "sep" },
                        ...taxRates.map((t) => ({
                          id: t.id,
                          label: `${t.display_name} ${percentText(t.percentage)}${t.inclusive ? " incl." : ""}`,
                          checked: ids.includes(t.id),
                        })),
                      ]}
                      onSelect={(id) => {
                        if (id === "__default") return setItem(it.key, { taxRates: null });
                        const cur = it.taxRates ?? form.defaultTaxRates;
                        setItem(it.key, { taxRates: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
                      }}
                    >
                      <span className="np-select-button__label">Tax:</span>
                      <span className="np-select-button__value">
                        {ids.length ? ids.map(rateName).join(", ") : "None"}
                      </span>
                    </MenuButton>
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
                onClick={() => set({ items: [...form.items, newItem()] })}
                disabled={form.items.length >= 20}
              >
                Add another price
              </Button>
            </div>
          </fieldset>
          {taxRates.length ? (
            <fieldset className="npf-billing__checks">
              <legend className="np-text-small">Default tax rates</legend>
              {taxRates.map((t) => (
                <Checkbox
                  key={t.id}
                  label={`${t.display_name} ${percentText(t.percentage)}`}
                  description={t.inclusive ? "Included in prices" : "Added on top"}
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
          ) : null}
          {FEATURE_STAGE >= 4 ? (
            <CollectionMethodField
              value={form.collectionMethod}
              onChange={(v) => set({ collectionMethod: v })}
              price={first}
              error={shown.collectionMethod}
            />
          ) : null}
          <div className="npf-billing__row-2">
            <Field
              label="Free trial (days)"
              error={shown.trialDays}
              hint="Optional. The first invoice is created when it ends."
            >
              <Input
                inputMode="numeric"
                numeric
                value={form.trialDays}
                onChange={(e) => set({ trialDays: e.target.value })}
                data-testid="trial-days"
              />
            </Field>
            <Field label="Invoices due after (days)" error={shown.daysUntilDue}>
              <Input
                inputMode="numeric"
                numeric
                value={form.daysUntilDue}
                onChange={(e) => set({ daysUntilDue: e.target.value })}
              />
            </Field>
          </div>
          <Field
            label="Reminder schedule"
            error={shown.reminders}
            hint="Days relative to each invoice's due date: negative before, 0 on the day."
          >
            <Input value={form.reminders} onChange={(e) => set({ reminders: e.target.value })} />
          </Field>
          <RadioCardGroup
            label="If an invoice is still unpaid after the last reminder"
            name="on-exhausted"
            value={form.onExhausted}
            onChange={(v) => set({ onExhausted: v as "cancel" | "unpaid" })}
          >
            <OptionCard
              value="cancel"
              title="Cancel the subscription"
              description="The invoice is marked uncollectible and billing stops."
            />
            <OptionCard
              value="unpaid"
              title="Keep it as Unpaid"
              description="No new invoices until the customer pays the latest one."
            />
          </RadioCardGroup>
          <Field
            label="Invoice text"
            error={shown.description}
            hint="Optional. Shown on every invoice of this subscription."
          >
            <Textarea
              rows={2}
              maxLength={500}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>
        </div>
        <aside className="npf-billing__aside" aria-label="Subscription summary">
          <Card>
            <div className="np-stack">
              <CardTitle as="h2">Summary</CardTitle>
              <KeyValueList
                items={[
                  {
                    label: "Billing period",
                    value: checked.schedule ? `Every ${intervalText(checked.schedule)}` : "—",
                  },
                  ...(FEATURE_STAGE >= 4
                    ? [{ label: "Collection", value: autoDebit ? "Auto-debit" : "Emailed invoices" }]
                    : []),
                  ...(checked.preview.ok
                    ? [
                        { label: "Subtotal", value: money(checked.preview.totals.subtotal) },
                        { label: "Tax", value: money(checked.preview.totals.tax) },
                        { label: "Each invoice", value: money(checked.preview.totals.total), total: true },
                      ]
                    : []),
                ]}
              />
              <p className="np-text-caption np-text-secondary">
                {trial
                  ? `Trial for ${form.trialDays.trim()} days, then the first invoice is emailed.`
                  : "The first invoice is created and emailed now; the subscription becomes active when it's paid."}{" "}
                {autoDebit
                  ? "Renewals are collected from the mandate the customer funds (one period at a time, only when due); without a funded mandate they're emailed as invoices."
                  : "Each renewal is an invoice the customer approves from their wallet — nothing is charged automatically."}
              </p>
              <ErrorNote error={error} />
              {touched && !checked.body ? (
                <p className="npf-billing__error" role="alert">
                  Check the highlighted fields.
                </p>
              ) : null}
              <Button
                type="submit"
                fullWidth
                loading={busy}
                loadingText="Creating…"
                disabled={blocked !== null}
                title={blocked ?? undefined}
                data-testid="create-subscription"
              >
                Create subscription
              </Button>
              {blocked ? <p className="np-text-caption np-text-secondary">{blocked}</p> : null}
            </div>
          </Card>
        </aside>
      </form>
    </Page>
  );
}

/** Stage 4: emailed invoices or auto-debit, with why the chosen prices can (or can't) be auto-debited. */
function CollectionMethodField({
  value,
  onChange,
  price,
  error,
}: {
  value: "send_invoice" | "auto_debit";
  onChange(v: "send_invoice" | "auto_debit"): void;
  price: Price | undefined;
  error: string | undefined;
}) {
  const app = useApp();
  const dests = useActiveDestinations();
  const elig: Eligibility = autoDebitEligibility(price, dests.data, (id) => app.assets.get(id)?.symbol);
  return (
    <div className="np-stack" data-testid="collection-method">
      <RadioCardGroup
        label="How renewals are collected"
        name="collection-method"
        value={value}
        onChange={(v) => onChange(v as "send_invoice" | "auto_debit")}
      >
        <OptionCard
          value="send_invoice"
          title="Email each invoice"
          description="The customer approves every payment from their wallet."
        />
        <OptionCard
          value="auto_debit"
          title="Auto-debit"
          description="The customer funds a mandate from their own NEAR account; NearPay collects one period when it's due. They can cancel at any time."
        />
      </RadioCardGroup>
      {value === "auto_debit" ? <EligibilityNote elig={elig} error={error} /> : null}
    </div>
  );
}

export function EligibilityNote({ elig, error }: { elig: Eligibility; error?: string | undefined }) {
  if (error || elig.kind === "ineligible")
    return (
      <Callout tone="danger" title="Auto-debit isn't available for these prices" data-testid="auto-debit-eligibility">
        {error ?? (elig.kind === "ineligible" ? elig.reason : "")}
        {elig.kind === "ineligible" && elig.fix ? (
          <>
            {" "}
            <Link to={elig.fix.to}>{elig.fix.label}</Link>.
          </>
        ) : null}
      </Callout>
    );
  return (
    <Callout
      tone={elig.kind === "eligible" ? "success" : "info"}
      title={`Customers fund it with ${elig.tokens}`}
      data-testid="auto-debit-eligibility"
    >
      {elig.kind === "check" ? `${elig.note} ` : ""}
      After you create the subscription, share its setup link: the customer signs the funding from their own NEAR wallet
      (no relayer or smart wallets). While a mandate is active, the per-period amount is locked.
    </Callout>
  );
}
