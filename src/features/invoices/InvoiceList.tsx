/**
 * Billing → Invoices (Figma b02 "Billing"): status filter (in the URL, ADR-0018), table Invoice ·
 * Customer · Due date · Amount · Status, cursor pager, empty state. `InvoiceTable` is reused by the
 * customer and subscription pages.
 */

import { buttonClassName, FilterBar, FilterPill, Pager, Table } from "@nearpay-internal/ui";
import { createInvoice, type Invoice } from "@nearpay-money/spec";
import { Link, useApp } from "../../app/context";
import { amountText } from "../../lib/billing";
import { formatDate } from "../../lib/format";
import { roleAllows } from "../../lib/permissions";
import { Empty } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import { BillingHub } from "../billing/Hub";
import { InvoiceStatus, invoiceTitle, useCustomerNames } from "../billing/shared";
import { type InvoiceFilter, type StatusFilter, useInvoiceList } from "./api";

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "past_due", label: "Past due" },
  { value: "paid", label: "Paid" },
  { value: "uncollectible", label: "Uncollectible" },
  { value: "void", label: "Void" },
];

const isStatus = (v: string | null): v is StatusFilter => STATUS_OPTIONS.some((o) => o.value === v);

export function InvoicesTab() {
  const app = useApp();
  const q = new URLSearchParams(app.location.search);
  const raw = q.get("status");
  const status: StatusFilter = isStatus(raw) ? raw : "";
  const canCreate = roleAllows(createInvoice, app.session?.role);
  const setStatus = (v: string) => {
    const next = new URLSearchParams(app.location.search);
    if (v) next.set("status", v);
    else next.delete("status");
    const s = next.toString();
    app.navigate(`/billing${s ? `?${s}` : ""}`, { replace: true });
  };
  const create = canCreate ? (
    <Link to="/billing/invoices/new" className={buttonClassName()} data-testid="create-invoice">
      <span>Create invoice</span>
    </Link>
  ) : undefined;
  return (
    <BillingHub tab="invoices" actions={create}>
      <FilterBar label="Invoice filters">
        <FilterPill
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
          data-testid="invoice-status-filter"
        />
      </FilterBar>
      <InvoiceTable filter={{ status }} emptyAction={create} />
    </BillingHub>
  );
}

export function InvoiceTable({
  filter,
  pageSize,
  showCustomer = true,
  emptyAction,
  caption = "Invoices",
}: {
  filter: InvoiceFilter;
  pageSize?: number;
  showCustomer?: boolean;
  emptyAction?: React.ReactNode;
  caption?: string;
}) {
  const app = useApp();
  const list = useInvoiceList(filter, pageSize);
  const rows = list.data?.data ?? [];
  const names = useCustomerNames(showCustomer ? rows.map((i) => i.customer) : []);
  const now = Math.floor(Date.now() / 1000);
  if (list.error) return <ErrorNote error={list.error} onRetry={list.reload} />;
  const filtered = Boolean(filter.status);
  if (!list.loading && rows.length === 0 && !list.hasPrevious && !filtered && !filter.customer && !filter.subscription)
    return (
      <Empty
        title="No invoices yet"
        action={emptyAction}
        footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
      >
        Create an invoice, finalize it and share its payment page. Your customer pays from their own wallet.
      </Empty>
    );
  return (
    <div data-testid="invoice-table">
      <Table<Invoice>
        caption={caption}
        loading={list.loading && !list.data}
        rows={rows}
        rowKey={(i) => i.id}
        rowHref={(i) => app.href(`/billing/invoices/${i.id}`)}
        empty={filtered ? "No invoices match this filter." : "No invoices."}
        columns={[
          { key: "n", header: "Invoice", primary: true, cell: (i) => invoiceTitle(i) },
          ...(showCustomer
            ? [{ key: "c", header: "Customer", hideOnNarrow: true, cell: (i: Invoice) => names.get(i.customer) ?? "…" }]
            : []),
          {
            key: "d",
            header: "Due date",
            hideOnNarrow: true,
            cell: (i) =>
              i.due_date
                ? formatDate(i.due_date)
                : i.days_until_due !== null
                  ? `${i.days_until_due} days after finalize`
                  : "—",
          },
          {
            key: "a",
            header: "Amount",
            numeric: true,
            cell: (i) => amountText({ amount: i.total, currency: i.currency, asset_id: i.asset_id }, app.assets),
          },
          { key: "s", header: "Status", cell: (i) => <InvoiceStatus invoice={i} now={now} /> },
        ]}
        footer={
          list.data && (list.hasNext || list.hasPrevious) ? (
            <Pager
              summary={rows.length ? `Showing ${list.offset}–${list.offset + rows.length - 1} invoices` : undefined}
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
