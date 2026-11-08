/** Customer detail: contact, wallets, paid totals and the customer's payments; edit and delete. */
import {
  type Customer,
  createInvoice,
  createSubscription,
  deleteCustomer,
  type PaymentIntent,
  updateCustomer,
} from "@nearpay/spec";
import {
  Button,
  Card,
  CardTitle,
  KeyValueList,
  LiveRegion,
  Modal,
  PageHeader,
  Pager,
  Stat,
  StatGroup,
  StatusBadge,
  Table,
  Tabs,
} from "@nearpay-internal/ui";
import { useRef, useState } from "react";
import { Link, useApp } from "../../app/context";
import { FEATURE_STAGE } from "../../app/registry";
import { roleAllows } from "../../lib/permissions";
import { InvoiceTable } from "../invoices/InvoiceList";
import { SubscriptionTable } from "../subscriptions/SubscriptionList";
import { useCustomer, useCustomerCalls, useCustomerPayments, useTotals } from "./api";
import { CustomerDialog } from "./CustomerForm";
import { chainName, customerName, paidTotals, relativeDay, serverTotals } from "./logic";
import { ActionError, ErrorState, PageSkeleton } from "./parts";
import { fmtDate, useSpaLinks } from "./ui";
import "./customers.css";

export function CustomerDetail({ id }: { id: string }) {
  const c = useCustomer(id);
  if (c.loading && !c.data) return <PageSkeleton label="Loading customer" />;
  if (c.error || !c.data)
    return <ErrorState error={c.error} onRetry={c.reload} title="We couldn't load this customer" />;
  return <CustomerView key={c.data.id} initial={c.data} />;
}

function CustomerView({ initial }: { initial: Customer }) {
  const app = useApp();
  const calls = useCustomerCalls();
  const [customer, setCustomer] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState(() =>
    new URLSearchParams(app.location.search).get("created") === "1" ? "Customer added." : "",
  );
  const fromApi = serverTotals(customer, app.assets);
  const scanned = useTotals(fromApi ? [] : [customer.id]).get(customer.id);
  const totals = fromApi ?? scanned;
  const root = useRef<HTMLDivElement>(null);
  useSpaLinks(root);
  const canEdit = roleAllows(updateCustomer, app.session?.role);
  const canDelete = roleAllows(deleteCustomer, app.session?.role);

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await calls.remove(customer.id);
      app.navigate(app.href("/customers"));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const t = totals && totals !== "error" ? totals : undefined;
  return (
    <div className="np-stack np-stack--lg" ref={root}>
      <LiveRegion>{announce}</LiveRegion>
      <PageHeader
        title={customerName(customer)}
        subtitle={customer.email ?? "No email on record"}
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" onClick={() => setEditing(true)} data-testid="edit-customer">
                Edit
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" onClick={() => setDeleting(true)} data-testid="delete-customer">
                Delete
              </Button>
            )}
          </>
        }
      />
      <ActionError error={error} />
      <StatGroup>
        <Stat
          label="Total paid"
          value={t ? (t.parts.length ? `${t.partial ? "≥ " : ""}${t.parts.join(" · ")}` : "—") : "…"}
          sub={totals === "error" ? "Couldn't load totals" : t?.partial ? "First 100 payments" : "Paid payments"}
        />
        <Stat label="Payments" value={t ? `${t.count}${t.partial ? "+" : ""}` : "…"} sub="Paid" />
        <Stat label="Last payment" value={t ? relativeDay(t.lastPaid) : "…"} />
      </StatGroup>
      <Card>
        <div className="np-stack">
          <CardTitle as="h2">Details</CardTitle>
          <KeyValueList
            items={[
              { label: "Name", value: customer.name ?? "—" },
              { label: "Receipt email", value: customer.email ?? "—" },
              { label: "Internal note", value: customer.description ?? "—" },
              { label: "Reference", value: <code className="npf-customers__mono">{customer.id}</code> },
              { label: "Added", value: fmtDate(customer.created) },
            ]}
          />
          <h3 className="np-text-h4">Wallets</h3>
          {customer.wallets.length === 0 ? (
            <p className="np-text-secondary">No wallets on record.</p>
          ) : (
            <ul className="npf-customers__wallet-list">
              {customer.wallets.map((w) => (
                <li key={`${w.chain}:${w.address}`}>
                  <span className="np-text-secondary">{chainName(w.chain)}</span>{" "}
                  <code className="npf-customers__mono">{w.address}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <CustomerActivity customerId={customer.id} />
      <CustomerDialog
        open={editing}
        customer={customer}
        onClose={() => setEditing(false)}
        onSaved={(c) => {
          setCustomer(c);
          setEditing(false);
          setAnnounce("Customer saved.");
        }}
      />
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this customer?"
        description="Their name, email and wallets are erased. Payments keep the customer reference. This can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              Keep customer
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()} data-testid="confirm-delete-customer">
              Delete customer
            </Button>
          </>
        }
      />
    </div>
  );
}

const INTENT_LABELS: Readonly<Record<string, string>> = {
  succeeded: "Paid",
  processing: "Confirming",
  requires_payment: "Not paid",
  requires_review: "Review",
  canceled: "Canceled",
  expired: "Expired",
};

type ActivityTab = "payments" | "invoices" | "subscriptions";

/** Payments · Invoices · Subscriptions of the customer (billing tabs from Stage 3; tab kept in `?tab=`). */
function CustomerActivity({ customerId }: { customerId: string }) {
  const app = useApp();
  const billing = FEATURE_STAGE >= 3;
  const raw = new URLSearchParams(app.location.search).get("tab");
  const tab: ActivityTab = billing && (raw === "invoices" || raw === "subscriptions") ? raw : "payments";
  if (!billing) return <CustomerPayments customerId={customerId} />;
  const select = (t: string) => {
    const q = new URLSearchParams(app.location.search);
    if (t === "payments") q.delete("tab");
    else q.set("tab", t);
    q.delete("created");
    const qs = q.toString();
    app.navigate(`${app.location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
  };
  return (
    <Tabs
      label="Customer activity"
      value={tab}
      onChange={select}
      items={[
        { id: "payments", label: "Payments" },
        { id: "invoices", label: "Invoices" },
        { id: "subscriptions", label: "Subscriptions" },
      ]}
    >
      {tab === "payments" ? <CustomerPayments customerId={customerId} /> : null}
      {tab === "invoices" ? (
        <div className="np-stack" data-testid="customer-invoices">
          {roleAllows(createInvoice, app.session?.role) ? (
            <div>
              <Link
                to={`/billing/invoices/new?customer=${customerId}`}
                className="np-button np-button--secondary np-button--sm"
              >
                <span>Create invoice</span>
              </Link>
            </div>
          ) : null}
          <InvoiceTable
            filter={{ status: "", customer: customerId }}
            showCustomer={false}
            pageSize={10}
            caption="Invoices of this customer"
          />
        </div>
      ) : null}
      {tab === "subscriptions" ? (
        <div className="np-stack" data-testid="customer-subscriptions">
          {roleAllows(createSubscription, app.session?.role) ? (
            <div>
              <Link
                to={`/billing/subscriptions/new?customer=${customerId}`}
                className="np-button np-button--secondary np-button--sm"
              >
                <span>New subscription</span>
              </Link>
            </div>
          ) : null}
          <SubscriptionTable filter={{ status: "", customer: customerId }} showCustomer={false} pageSize={10} />
        </div>
      ) : null}
    </Tabs>
  );
}

function CustomerPayments({ customerId }: { customerId: string }) {
  const app = useApp();
  const p = useCustomerPayments(customerId);
  const amount = (i: PaymentIntent) => paidTotals([{ ...i, status: "succeeded" }], app.assets).parts[0] ?? "—";
  return (
    <section className="np-stack" aria-labelledby="npf-customer-payments">
      <h2 className="np-text-h4" id="npf-customer-payments">
        Payments
      </h2>
      {p.error ? (
        <ErrorState error={p.error} onRetry={p.reload} title="We couldn't load payments" />
      ) : (
        <Table
          caption="Payments of this customer"
          columns={[
            { key: "d", header: "Payment", primary: true, cell: (i: PaymentIntent) => i.description ?? i.id },
            { key: "a", header: "Amount", numeric: true, cell: amount },
            {
              key: "s",
              header: "Status",
              cell: (i: PaymentIntent) => <StatusBadge>{INTENT_LABELS[i.status] ?? i.status}</StatusBadge>,
            },
            { key: "t", header: "Date", hideOnNarrow: true, cell: (i: PaymentIntent) => fmtDate(i.created) },
          ]}
          rows={p.data?.data ?? []}
          rowKey={(i) => i.id}
          rowHref={(i) => app.href(`/payments/${i.id}`)}
          loading={p.loading}
          empty="No payments for this customer yet."
          footer={
            p.data && (p.data.has_more || p.page > 0) ? (
              <Pager hasPrevious={p.page > 0} hasNext={p.data.has_more} onPrevious={p.previous} onNext={p.next} />
            ) : undefined
          }
        />
      )}
    </section>
  );
}
