/**
 * Subscription detail (lld/billing.md §4, §11 d8–d9): plan, current period, the upcoming renewal
 * invoice (estimate), dunning status of the latest invoice, the subscription's invoices, and cancel
 * now / at period end (or undo a scheduled cancellation). Canceling never refunds or credits (no
 * proration in v1) and leaves open invoices as they are.
 * Stage 4 (billing §14): the collection method (switch between emailed invoices and auto-debit —
 * leaving auto-debit releases a linked mandate) and the auto-debit panel (`SubscriptionMandate`).
 */
import { cancelSubscription, type Subscription, updateSubscription } from "@nearpay/spec";
import { Button, Callout, KeyValueList, LiveRegion, MenuButton, Table, useToast } from "@nearpay-internal/ui";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { FEATURE_STAGE } from "../../app/registry";
import { amountText, dunningState, isPastDue, percentText, priceSummary } from "../../lib/billing";
import { formatDate, formatWhen } from "../../lib/format";
import { roleAllows } from "../../lib/permissions";
import { ConfirmDialog, ErrorState, LoadingState, Page, Section, StatRow } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import "../billing/billing.css";
import {
  InvoiceStatus,
  invoiceTitle,
  SubscriptionStatus,
  useCustomerNames,
  useProductNames,
  useTaxRateIndex,
} from "../billing/shared";
import { InvoiceTable } from "../invoices/InvoiceList";
import { SubscriptionMandate } from "../mandates/SubscriptionMandate";
import { useLatestInvoice, useSubscription } from "./api";
import { dunningText, nextInvoiceText, subscriptionActions, upcomingRenewal } from "./logic";

export function SubscriptionDetail({ id }: { id: string }) {
  const s = useSubscription(id);
  if (s.loading && !s.data) return <LoadingState what="Loading subscription" stats={3} />;
  if (s.error || !s.data) return <ErrorState title="Subscription" error={s.error} onRetry={s.reload} />;
  return <SubscriptionView key={s.data.id} initial={s.data} />;
}

type Pending = "now" | "period_end" | "undo" | "auto_debit" | "send_invoice" | undefined;

const REASON: Readonly<Record<string, string>> = {
  requested: "Canceled by you",
  dunning_exhausted: "Canceled after the last reminder went unpaid",
  incomplete_expired: "The first invoice was never paid",
};

function SubscriptionView({ initial }: { initial: Subscription }) {
  const app = useApp();
  const toast = useToast();
  const [sub, setSub] = useState(initial);
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState(() =>
    new URLSearchParams(app.location.search).get("created") === "1" ? "Subscription created." : "",
  );
  const customers = useCustomerNames([sub.customer]);
  const products = useProductNames(sub.items.map((i) => i.price.product));
  const taxIndex = useTaxRateIndex();
  const latest = useLatestInvoice(sub);
  const acts = subscriptionActions(sub);
  const canChange = roleAllows(cancelSubscription, app.session?.role);
  const customer = customers.get(sub.customer) ?? "…";
  const money = (amount: bigint | number | string) =>
    amountText({ amount, currency: sub.currency, asset_id: sub.asset_id }, app.assets);
  const perPeriod = sub.items.reduce((s, i) => s + BigInt(i.price.unit_amount) * BigInt(i.quantity), 0n);
  const renewal = taxIndex.data ? upcomingRenewal(sub, taxIndex.data) : undefined;
  const now = Math.floor(Date.now() / 1000);

  const act = async (p: Exclude<Pending, undefined>) => {
    setBusy(true);
    setError(undefined);
    try {
      const next =
        p === "undo"
          ? await app.api.call(updateSubscription, { params: { id: sub.id }, body: { cancel_at_period_end: false } })
          : p === "auto_debit" || p === "send_invoice"
            ? await app.api.call(updateSubscription, { params: { id: sub.id }, body: { collection_method: p } })
            : await app.api.call(cancelSubscription, {
                params: { id: sub.id },
                body: { at_period_end: p === "period_end" },
              });
      setSub(next as Subscription);
      setPending(undefined);
      const msg =
        p === "auto_debit"
          ? "Auto-debit is on. Share the setup link with the customer."
          : p === "send_invoice"
            ? "Renewals are emailed as invoices from now on."
            : p === "undo"
              ? "Cancellation undone. The subscription renews as usual."
              : p === "period_end"
                ? `The subscription ends on ${formatDate(sub.current_period_end)}.`
                : "Subscription canceled.";
      setAnnounce(msg);
      toast.show({ tone: "success", title: msg });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const menu = [
    ...(acts.cancelAtPeriodEnd ? [{ id: "period_end", label: "Cancel at period end" }] : []),
    ...(acts.cancelNow ? [{ id: "now", label: "Cancel now", danger: true }] : []),
  ];
  const actions = canChange ? (
    <>
      {acts.undoCancel ? (
        <Button variant="secondary" onClick={() => setPending("undo")} data-testid="undo-cancel">
          Don't cancel
        </Button>
      ) : null}
      {menu.length ? (
        <MenuButton
          label="Cancel subscription"
          variant="select"
          items={menu}
          onSelect={(id) => setPending(id as Pending)}
          align="end"
          data-testid="cancel-menu"
        >
          Cancel subscription
        </MenuButton>
      ) : null}
    </>
  ) : undefined;

  const li = latest.data;
  const dun = li ? dunningState(li) : undefined;
  const autoDebit = (sub.collection_method as string) === "auto_debit";
  const canSwitch = FEATURE_STAGE >= 4 && canChange && sub.status !== "canceled";
  return (
    <Page
      title={customer}
      subtitle={`Subscription · started ${formatDate(sub.created)}`}
      status={<SubscriptionStatus subscription={sub} />}
      back={{ label: "Subscriptions", to: "/billing/subscriptions" }}
      actions={actions}
      data-testid="subscription-detail"
    >
      <LiveRegion>{announce}</LiveRegion>
      <ErrorNote error={error} />
      <StatRow
        items={[
          {
            label: "Plan",
            value: `${money(perPeriod)}`,
            sub: `Every ${sub.recurring.interval_count === 1 ? sub.recurring.interval : `${sub.recurring.interval_count} ${sub.recurring.interval}s`} · before tax`,
          },
          {
            label: sub.status === "trialing" ? "Trial ends" : "Current period",
            value:
              sub.status === "trialing" && sub.trial_end
                ? formatDate(sub.trial_end)
                : `${formatDate(sub.current_period_start).replace(/ \d{4}$/, "")} – ${formatDate(sub.current_period_end)}`,
          },
          {
            label: "Next invoice",
            value: nextInvoiceText(sub, formatDate),
            sub: autoDebit
              ? "Collected from the customer's mandate when funded"
              : "Emailed; the customer pays from their wallet",
          },
        ]}
      />
      {sub.cancel_at_period_end && sub.status !== "canceled" ? (
        <Callout tone="warning" title={`Cancels on ${formatDate(sub.current_period_end)}`}>
          No renewal invoice will be created. Open invoices stay payable; void them if they shouldn't be paid.
        </Callout>
      ) : null}
      {sub.status === "canceled" ? (
        <Callout tone="neutral" title={REASON[sub.cancellation_reason ?? ""] ?? "Canceled"}>
          Ended {formatWhen(sub.ended_at ?? sub.canceled_at)}. No further invoices are created.
        </Callout>
      ) : null}
      {sub.status === "incomplete" ? (
        <Callout title="Waiting for the first payment">
          The first invoice was emailed to the customer. The subscription becomes active when it's paid.
        </Callout>
      ) : null}

      <Section title="Items">
        <Table
          caption="Subscription items"
          rows={sub.items}
          rowKey={(i) => i.id}
          columns={[
            {
              key: "p",
              header: "Product",
              primary: true,
              cell: (i) => (
                <Link to={`/billing/products/${i.price.product}`}>{products.get(i.price.product) ?? "…"}</Link>
              ),
            },
            { key: "u", header: "Price", cell: (i) => priceSummary(i.price, app.assets) },
            { key: "q", header: "Qty", numeric: true, cell: (i) => String(i.quantity) },
            {
              key: "t",
              header: "Tax",
              hideOnNarrow: true,
              cell: (i) => {
                const ids = i.tax_rates ?? sub.default_tax_rates;
                if (!ids.length) return "None";
                return ids
                  .map((id) => {
                    const t = taxIndex.data?.get(id);
                    return t ? `${t.display_name} ${percentText(t.percentage)}` : "Tax rate";
                  })
                  .join(", ");
              },
            },
          ]}
        />
      </Section>

      {FEATURE_STAGE >= 4 ? (
        <SubscriptionMandate sub={sub} latest={li} merchant={app.session?.account.display_name ?? "NearPay merchant"} />
      ) : null}

      <div className="npf-billing__columns">
        <Section title="Upcoming renewal invoice" data-testid="upcoming-renewal">
          {renewal?.preview.ok ? (
            <>
              <KeyValueList
                items={[
                  { label: "Period", value: `${formatDate(renewal.start)} – ${formatDate(renewal.end)}` },
                  { label: "Created", value: formatDate(renewal.start) },
                  { label: "Subtotal", value: money(renewal.preview.totals.subtotal) },
                  { label: "Tax", value: money(renewal.preview.totals.tax) },
                  { label: "Amount due", value: money(renewal.preview.totals.total), total: true },
                ]}
              />
              <p className="np-text-caption np-text-secondary">
                Estimate with today's prices and tax rates. Due {sub.days_until_due} days after it's created.
                {renewal.ratesMissing ? " Some tax rates couldn't be loaded, so tax may be higher." : ""}
              </p>
            </>
          ) : (
            <p className="np-text-secondary">
              {sub.status === "canceled" || sub.cancel_at_period_end
                ? "No renewal: the subscription is canceled."
                : sub.status === "unpaid"
                  ? "No renewal until the latest invoice is paid."
                  : sub.status === "incomplete"
                    ? "Renewals start once the first invoice is paid."
                    : taxIndex.error
                      ? "Couldn't load tax rates for the estimate."
                      : "Calculating…"}
            </p>
          )}
        </Section>
        <Section
          title="Collection"
          data-testid="dunning"
          actions={
            canSwitch ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPending(autoDebit ? "send_invoice" : "auto_debit")}
                data-testid="switch-collection"
              >
                {autoDebit ? "Use emailed invoices" : "Use auto-debit"}
              </Button>
            ) : undefined
          }
        >
          <KeyValueList
            items={[
              {
                label: "Method",
                value: autoDebit
                  ? "Auto-debit · collected from the customer's mandate, else emailed"
                  : "Email invoice · customer pays from their wallet",
              },
              {
                label: "Latest invoice",
                value: li ? (
                  <span className="npf-billing__inline">
                    <Link to={`/billing/invoices/${li.id}`}>{invoiceTitle(li)}</Link>{" "}
                    <InvoiceStatus invoice={li} now={now} />
                  </span>
                ) : latest.loading ? (
                  "…"
                ) : (
                  "None yet"
                ),
              },
              ...(li && dun
                ? [
                    {
                      label: "Reminders",
                      value:
                        dun.kind === "scheduled"
                          ? `${dun.sent} of ${dun.total} sent${dun.next ? ` · next ${formatWhen(dun.next)}` : ""}`
                          : dun.kind === "exhausted"
                            ? `All ${dun.total} sent`
                            : li.status === "paid"
                              ? "Not needed — paid"
                              : "None",
                    },
                  ]
                : []),
              ...(li && isPastDue(li, now) ? [{ label: "Overdue since", value: formatDate(li.due_date) }] : []),
              { label: "Dunning", value: dunningText(sub.dunning) },
            ]}
          />
        </Section>
      </div>

      <Section title="Invoices">
        <InvoiceTable
          filter={{ status: "", subscription: sub.id }}
          showCustomer={false}
          pageSize={10}
          caption="Invoices of this subscription"
        />
      </Section>

      <Section title="Details">
        <KeyValueList
          items={[
            { label: "Customer", value: <Link to={`/customers/${sub.customer}`}>{customer}</Link> },
            { label: "Billing anchor", value: formatWhen(sub.billing_cycle_anchor) },
            { label: "Invoice due after", value: `${sub.days_until_due} days` },
            ...(sub.trial_start
              ? [{ label: "Trial", value: `${formatDate(sub.trial_start)} – ${formatDate(sub.trial_end)}` }]
              : []),
            { label: "Invoice text", value: sub.description ?? "—" },
            { label: "Subscription ID", value: <code className="npf-billing__mono">{sub.id}</code> },
          ]}
        />
      </Section>

      <ConfirmDialog
        open={pending === "period_end"}
        title="Cancel at the end of this period?"
        description={`The subscription stays active until ${formatDate(sub.current_period_end)} and no renewal invoice is created. You can undo this until then.`}
        confirmLabel="Cancel at period end"
        busy={busy}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() => void act("period_end")}
      />
      <ConfirmDialog
        open={pending === "now"}
        title="Cancel this subscription now?"
        description="It ends immediately; nothing is refunded or credited. Open invoices stay payable — void them if they shouldn't be paid. This can't be undone."
        confirmLabel="Cancel now"
        busy={busy}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() => void act("now")}
      />
      <ConfirmDialog
        open={pending === "auto_debit"}
        title="Collect renewals with auto-debit?"
        description="Renewals are collected from a mandate the customer funds from their own NEAR wallet. Until they fund one, renewals are still emailed as invoices. You'll get a setup link to share."
        confirmLabel="Use auto-debit"
        tone="primary"
        busy={busy}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() => void act("auto_debit")}
      />
      <ConfirmDialog
        open={pending === "send_invoice"}
        title="Switch to emailed invoices?"
        description="Renewals are emailed and the customer approves each payment. If a mandate is linked, NearPay releases it and emails the customer how to cancel it and get their balance back."
        confirmLabel="Use emailed invoices"
        busy={busy}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() => void act("send_invoice")}
      />
      <ConfirmDialog
        open={pending === "undo"}
        title="Keep this subscription?"
        description="The scheduled cancellation is removed and the next renewal invoice is created as usual."
        confirmLabel="Keep subscription"
        tone="primary"
        busy={busy}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() => void act("undo")}
      />
    </Page>
  );
}
