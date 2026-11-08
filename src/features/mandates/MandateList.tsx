/**
 * Billing → Auto-debit (lld/billing.md §14; spec 0.4.0 `listMandates`): every mandate customers funded in
 * this mode, with filters kept in the URL (status, linked/unlinked, payer NEAR account). `MandateTable` is
 * reused on the subscription page. Rows come from the chain only (billing §14 d1): a mandate appears once
 * the customer's funding transaction landed.
 */
import { NearAccountId } from "@nearpay/spec";
import { Button, buttonClassName, Callout, FilterBar, FilterPill, Pager, SearchInput, Table } from "@nearpay-internal/ui";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatDate } from "../../lib/format";
import type { Mandate } from "../../lib/spec-next";
import { Empty } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import { BillingHub } from "../billing/Hub";
import { useCustomerNames } from "../billing/shared";
import { type MandateFilter, useMandateList } from "./api";
import { periodText } from "./logic";
import { MandateStatus, useToken } from "./parts";

const STATUS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "insufficient", label: "Low balance" },
  { value: "exhausted", label: "Ended" },
  { value: "canceled", label: "Canceled" },
] as const;
const LINK = [
  { value: "", label: "All" },
  { value: "linked", label: "Linked" },
  { value: "unlinked", label: "Unlinked" },
] as const;

export const AUTO_DEBIT_NOTE = (
  <Callout title="Customer-funded, customer-controlled">
    Customers fund a mandate in the NearPay subscription vault from their own NEAR wallet. NearPay can only trigger a
    collection of one period when it's due; customers can cancel at any time and get the remaining balance back.
  </Callout>
);

export function MandatesTab() {
  const app = useApp();
  const sp = new URLSearchParams(app.location.search);
  const pick = <T extends readonly { value: string }[]>(opts: T, v: string | null) =>
    opts.some((o) => o.value === v) ? (v as string) : "";
  const filter: MandateFilter = {
    status: pick(STATUS, sp.get("status")),
    link_status: pick(LINK, sp.get("link")),
    payer: NearAccountId.safeParse(sp.get("payer") ?? "").success ? (sp.get("payer") ?? "") : "",
  };
  const [payer, setPayer] = useState(filter.payer ?? "");
  const payerValid = payer === "" || NearAccountId.safeParse(payer.trim()).success;
  const go = (next: Partial<{ status: string; link: string; payer: string }>) => {
    const q = new URLSearchParams();
    const merged = { status: filter.status, link: filter.link_status, payer: filter.payer, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    app.navigate(`/billing/mandates${s ? `?${s}` : ""}`, { replace: true });
  };
  return (
    <BillingHub tab="mandates" note={AUTO_DEBIT_NOTE}>
      <FilterBar
        label="Mandate filters"
        actions={
          <form
            className="npf-mandates__search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (payerValid) go({ payer: payer.trim() });
            }}
          >
            <SearchInput
              aria-label="Find mandates by payer NEAR account"
              placeholder="Payer NEAR account"
              value={payer}
              onChange={(e) => {
                setPayer(e.target.value);
                if (e.target.value === "" && filter.payer) go({ payer: "" });
              }}
              aria-invalid={!payerValid || undefined}
              data-testid="mandate-payer-search"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={!payerValid}>
              Search
            </Button>
          </form>
        }
      >
        <FilterPill
          label="Status"
          options={STATUS}
          value={filter.status ?? ""}
          onChange={(v) => go({ status: v })}
          data-testid="mandate-status-filter"
        />
        <FilterPill
          label="Link"
          options={LINK}
          value={filter.link_status ?? ""}
          onChange={(v) => go({ link: v })}
          data-testid="mandate-link-filter"
        />
      </FilterBar>
      <MandateTable filter={filter} />
    </BillingHub>
  );
}

export function MandateTable({
  filter,
  showCustomer = true,
  pageSize,
  caption = "Mandates",
}: {
  filter: MandateFilter;
  showCustomer?: boolean;
  pageSize?: number;
  caption?: string;
}) {
  const app = useApp();
  const list = useMandateList(filter, pageSize);
  const rows = list.data?.data ?? [];
  const customers = useCustomerNames(showCustomer ? rows.map((m) => m.customer) : []);
  const token = useToken();
  const filtered = Boolean(filter.status || filter.link_status || filter.payer);
  if (list.error) return <ErrorNote error={list.error} onRetry={list.reload} />;
  if (!list.loading && rows.length === 0 && !list.hasPrevious && !filtered && !filter.subscription)
    return (
      <Empty
        title="No auto-debit mandates yet"
        action={
          <Link to="/billing/subscriptions" className={buttonClassName({ variant: "secondary" })}>
            <span>Go to subscriptions</span>
          </Link>
        }
        footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
      >
        Choose auto-debit on a subscription and share the setup link. A mandate shows here once the customer funds it
        from their NEAR wallet.
      </Empty>
    );
  return (
    <div data-testid="mandate-table">
      <Table<Mandate>
        caption={caption}
        loading={list.loading && !list.data}
        rows={rows}
        rowKey={(m) => m.id}
        rowHref={(m) => app.href(`/billing/mandates/${m.id}`)}
        empty={filtered ? "No mandates match these filters." : "No mandates."}
        columns={[
          ...(showCustomer
            ? [
                {
                  key: "c",
                  header: "Customer",
                  primary: true,
                  cell: (m: Mandate) => customers.get(m.customer) ?? "…",
                },
              ]
            : []),
          {
            key: "p",
            header: "Payer",
            primary: !showCustomer,
            hideOnNarrow: showCustomer,
            cell: (m) => <span className="npf-mandates__account">{m.payer}</span>,
          },
          {
            key: "a",
            header: "Per period",
            cell: (m) => `${token(m.asset_id, m.amount_per_period)} / ${periodText(m.period_secs)}`,
          },
          {
            key: "b",
            header: "Balance",
            numeric: true,
            hideOnNarrow: true,
            cell: (m) => (
              <span>
                {token(m.asset_id, m.balance)}
                <span className="np-text-caption np-text-secondary npf-mandates__sub">
                  {m.funded_periods} period{m.funded_periods === 1 ? "" : "s"} left
                </span>
              </span>
            ),
          },
          {
            key: "n",
            header: "Next collection",
            hideOnNarrow: true,
            cell: (m) => (m.next_collect_at && m.collecting ? formatDate(m.next_collect_at) : "—"),
          },
          { key: "s", header: "Status", cell: (m) => <MandateStatus mandate={m} /> },
        ]}
        footer={
          list.data && (list.hasNext || list.hasPrevious) ? (
            <Pager
              summary={rows.length ? `Showing ${list.offset}–${list.offset + rows.length - 1} mandates` : undefined}
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
