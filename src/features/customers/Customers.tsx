/**
 * Customers list (Figma b03): Customer · Reference · Total paid · Last payment, "Wallet-only checkout"
 * callout, add customer, exact email lookup (the list filter is `email`, ADR-0018), cursor pager.
 */

import {
  Button,
  Callout,
  EmptyState,
  PageHeader,
  Pager,
  SearchInput,
  Skeleton,
  Table,
  type TableColumn,
} from "@nearpay-internal/ui";
import { type Customer, createCustomer, listCustomers } from "@nearpay-money/spec";
import { useRef, useState } from "react";
import { useApp } from "../../app/context";
import { roleAllows } from "../../lib/permissions";
import { PAGE_SIZE, useCustomerList, useTotals } from "./api";
import { CustomerDialog } from "./CustomerForm";
import { customerName, relativeDay, serverTotals, type Totals } from "./logic";
import { ErrorState, RoleNotice } from "./parts";
import { useSpaLinks } from "./ui";
import "./customers.css";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Customers() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useCustomerList(email);
  const rows = list.data?.data ?? [];
  const server = new Map<string, Totals | undefined>(rows.map((c) => [c.id, serverTotals(c, app.assets)]));
  // spec 0.2.1 servers send totals; older ones are summed from payments (first 100 per customer)
  const scanned = useTotals(rows.filter((c) => !server.get(c.id)).map((c) => c.id));
  const totals = { get: (id: string) => server.get(id) ?? scanned.get(id) };
  const root = useRef<HTMLDivElement>(null);
  useSpaLinks(root);
  const canAdd = roleAllows(createCustomer, app.session?.role);

  const addBtn = canAdd ? (
    <Button onClick={() => setAdding(true)} data-testid="add-customer">
      Add customer
    </Button>
  ) : undefined;
  const header = (
    <PageHeader title="Customers" subtitle="Payment history connected to your customer records." actions={addBtn} />
  );
  if (!roleAllows(listCustomers, app.session?.role))
    return (
      <div className="np-stack np-stack--lg">
        {header}
        <RoleNotice>Customers are available to owners, admins, finance and support members.</RoleNotice>
      </div>
    );

  const totalCell = (c: Customer, pick: "total" | "last") => {
    const t = totals.get(c.id);
    if (t === undefined) return <Skeleton width="50" />;
    if (t === "error") return <span className="np-text-secondary">Unavailable</span>;
    if (pick === "last") return relativeDay(t.lastPaid);
    if (t.parts.length === 0) return "—";
    return `${t.partial ? "≥ " : ""}${t.parts.join(" · ")}`;
  };

  const columns: TableColumn<Customer>[] = [
    { key: "name", header: "Customer", primary: true, cell: (c) => customerName(c) },
    {
      key: "ref",
      header: "Reference",
      hideOnNarrow: true,
      cell: (c) => <code className="npf-customers__mono">{c.id}</code>,
    },
    { key: "total", header: "Total paid", numeric: true, cell: (c) => totalCell(c, "total") },
    { key: "last", header: "Last payment", hideOnNarrow: true, cell: (c) => totalCell(c, "last") },
  ];
  const first = list.page * PAGE_SIZE + 1;
  const emptyAll = !list.loading && rows.length === 0 && list.page === 0 && !email;
  const queryValid = query.trim() === "" || EMAIL.test(query.trim());

  return (
    <div className="np-stack np-stack--lg" ref={root}>
      {header}
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} title="We couldn't load customers" />
      ) : emptyAll ? (
        <EmptyState
          title="No customers yet"
          action={addBtn}
          footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
        >
          Add a customer when your business needs a record — for receipts or to group a payer's payments.
        </EmptyState>
      ) : (
        <>
          <search className="npf-customers__search">
            <form
              className="npf-customers__search-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (queryValid) setEmail(query.trim().toLowerCase());
              }}
            >
              <SearchInput
                aria-label="Find a customer by email"
                placeholder="Find by exact email"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value === "") setEmail("");
                }}
                aria-invalid={!queryValid || undefined}
              />
              <Button type="submit" variant="secondary" size="sm" disabled={!queryValid}>
                Search
              </Button>
            </form>
          </search>
          <Table
            caption="Customers"
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            rowHref={(c) => app.href(`/customers/${c.id}`)}
            loading={list.loading}
            empty={email ? `No customer with the email ${email}.` : "No customers."}
            footer={
              list.data && (list.data.has_more || list.page > 0) ? (
                <Pager
                  summary={rows.length ? `Showing ${first}–${first + rows.length - 1} customers` : undefined}
                  hasPrevious={list.page > 0}
                  hasNext={list.data.has_more}
                  onPrevious={list.previous}
                  onNext={list.next}
                />
              ) : undefined
            }
          />
        </>
      )}
      <Callout title="Wallet-only checkout">
        A payer does not need an email or NearPay account. Associate a customer record only when your business needs
        one.
      </Callout>
      <CustomerDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(c) => {
          setAdding(false);
          app.navigate(app.href(`/customers/${c.id}?created=1`));
        }}
      />
    </div>
  );
}
