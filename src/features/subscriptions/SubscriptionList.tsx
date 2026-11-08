/**
 * Billing → Subscriptions (Figma b02 "Subscriptions"): status filter (URL), table Customer · Plan ·
 * Next invoice · Collection · Status, "No surprise charges" note. `SubscriptionTable` is reused on the
 * customer page.
 */
import { createSubscription, type Subscription } from "@nearpay/spec";
import { buttonClassName, Callout, FilterBar, FilterPill, Pager, Table } from "@nearpay-internal/ui";
import type { ReactNode } from "react";
import { Link, useApp } from "../../app/context";
import { priceSummary } from "../../lib/billing";
import { formatDate } from "../../lib/format";
import { roleAllows } from "../../lib/permissions";
import { Empty } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import { BillingHub } from "../billing/Hub";
import { SubscriptionStatus, useCustomerNames, useProductNames } from "../billing/shared";
import { type SubStatusFilter, useSubscriptionList } from "./api";
import { nextInvoiceText } from "./logic";

const STATUS: readonly { value: SubStatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "trialing", label: "Trialing" },
  { value: "incomplete", label: "Incomplete" },
  { value: "past_due", label: "Past due" },
  { value: "unpaid", label: "Unpaid" },
  { value: "canceled", label: "Canceled" },
];

export const NO_SURPRISE = (
  <Callout title="No surprise charges">
    With invoice-based subscriptions, the payer approves each renewal. Don't present these as automatically charged.
    Auto-debit subscriptions collect from a mandate the customer funded themselves and can cancel at any time.
  </Callout>
);

export function SubscriptionsTab() {
  const app = useApp();
  const raw = new URLSearchParams(app.location.search).get("status") ?? "";
  const status = (STATUS.some((o) => o.value === raw) ? raw : "") as SubStatusFilter;
  const action = roleAllows(createSubscription, app.session?.role) ? (
    <Link to="/billing/subscriptions/new" className={buttonClassName()} data-testid="new-subscription">
      <span>New subscription</span>
    </Link>
  ) : undefined;
  return (
    <BillingHub tab="subscriptions" actions={action} note={NO_SURPRISE}>
      <FilterBar label="Subscription filters">
        <FilterPill
          label="Status"
          options={STATUS}
          value={status}
          onChange={(v) => app.navigate(`/billing/subscriptions${v ? `?status=${v}` : ""}`, { replace: true })}
          data-testid="subscription-status-filter"
        />
      </FilterBar>
      <SubscriptionTable filter={{ status }} emptyAction={action} />
    </BillingHub>
  );
}

export function SubscriptionTable({
  filter,
  showCustomer = true,
  emptyAction,
  pageSize,
}: {
  filter: { status: SubStatusFilter; customer?: string };
  showCustomer?: boolean;
  emptyAction?: ReactNode;
  pageSize?: number;
}) {
  const app = useApp();
  const list = useSubscriptionList(filter, pageSize);
  const rows = list.data?.data ?? [];
  const customers = useCustomerNames(showCustomer ? rows.map((s) => s.customer) : []);
  const products = useProductNames(rows.flatMap((s) => s.items.slice(0, 1).map((i) => i.price.product)));
  if (list.error) return <ErrorNote error={list.error} onRetry={list.reload} />;
  if (!list.loading && rows.length === 0 && !list.hasPrevious && !filter.status && !filter.customer)
    return (
      <Empty
        title="No subscriptions yet"
        action={emptyAction}
        footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
      >
        Bill a customer every period. Each renewal is an invoice they approve from their wallet.
      </Empty>
    );
  const plan = (s: Subscription) => {
    const first = s.items[0];
    if (!first) return "—";
    const name = products.get(first.price.product) ?? "…";
    const more = s.items.length > 1 ? ` + ${s.items.length - 1} more` : "";
    const qty = first.quantity > 1 ? ` × ${first.quantity}` : "";
    return `${name} · ${priceSummary(first.price, app.assets)}${qty}${more}`;
  };
  return (
    <div data-testid="subscription-table">
      <Table<Subscription>
        caption="Subscriptions"
        loading={list.loading && !list.data}
        rows={rows}
        rowKey={(s) => s.id}
        rowHref={(s) => app.href(`/billing/subscriptions/${s.id}`)}
        empty={filter.status ? "No subscriptions match this filter." : "No subscriptions."}
        columns={[
          ...(showCustomer
            ? [
                {
                  key: "c",
                  header: "Customer",
                  primary: true,
                  cell: (s: Subscription) => customers.get(s.customer) ?? "…",
                },
              ]
            : []),
          { key: "p", header: "Plan", primary: !showCustomer, hideOnNarrow: showCustomer, cell: plan },
          { key: "n", header: "Next invoice", cell: (s) => nextInvoiceText(s, formatDate) },
          {
            key: "m",
            header: "Collection",
            hideOnNarrow: true,
            cell: (s) => (s.collection_method === "auto_debit" ? "Auto-debit" : "Pay each invoice"),
          },
          { key: "s", header: "Status", cell: (s) => <SubscriptionStatus subscription={s} /> },
        ]}
        footer={
          list.data && (list.hasNext || list.hasPrevious) ? (
            <Pager
              summary={
                rows.length ? `Showing ${list.offset}–${list.offset + rows.length - 1} subscriptions` : undefined
              }
              hasPrevious={list.hasPrevious}
              hasNext={list.hasNext}
              onPrevious={list.previous}
              onNext={list.next}
            />
          ) : undefined
        }
      />
    </div>
  );
}
