/** Payment links list (Figma b01): Link · Price · Payments · Status, the reuse callout, filter and pager. */
import { createPaymentLink, listPaymentLinks, type PaymentLink } from "@nearpay/spec";
import {
  buttonClassName,
  Callout,
  EmptyState,
  PageHeader,
  Pager,
  SegmentedControl,
  StatusBadge,
  Table,
  type TableColumn,
} from "@nearpay-internal/ui";
import { useRef, useState } from "react";
import { useApp } from "../../app/context";
import { roleAllows } from "../../lib/permissions";
import { PAGE_SIZE, useLinkList } from "./api";
import { linkStatus, priceText, usesText } from "./logic";
import { ErrorState, RoleNotice } from "./parts";
import { useSpaLinks } from "./ui";
import "./payment-links.css";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "true", label: "Active" },
  { id: "false", label: "Disabled" },
] as const;

export function PaymentLinks() {
  const app = useApp();
  const [filter, setFilter] = useState<"all" | "true" | "false">("all");
  const list = useLinkList(filter);
  const root = useRef<HTMLDivElement>(null);
  useSpaLinks(root);
  const canCreate = roleAllows(createPaymentLink, app.session?.role);
  const createBtn = canCreate ? (
    <a href={app.href("/payment-links/new")} className={buttonClassName()} data-testid="new-link">
      Create payment link
    </a>
  ) : undefined;

  const columns: TableColumn<PaymentLink>[] = [
    {
      key: "link",
      header: "Link",
      primary: true,
      // spec 0.2.1 `name` (internal) first, the payer-facing title under it
      cell: (l) =>
        l.name ? (
          <span className="npf-payment-links__name">
            <span>{l.name}</span>
            <span className="np-text-small np-text-secondary">{l.description}</span>
          </span>
        ) : (
          l.description
        ),
    },
    { key: "price", header: "Price", numeric: true, cell: (l) => priceText(l, app.assets) },
    { key: "uses", header: "Payments", numeric: true, cell: (l) => usesText(l) },
    {
      key: "status",
      header: "Status",
      cell: (l) => {
        const s = linkStatus(l);
        return <StatusBadge title={s.detail}>{s.label}</StatusBadge>;
      },
    },
  ];

  const header = (
    <PageHeader
      title="Payment links"
      subtitle="Share a checkout anywhere your customers are."
      actions={list.data && list.data.data.length === 0 && list.page === 0 && filter === "all" ? undefined : createBtn}
    />
  );
  if (!roleAllows(listPaymentLinks, app.session?.role))
    return (
      <div className="np-stack np-stack--lg">
        {header}
        <RoleNotice>Payment links are available to owners, admins, developers and finance members.</RoleNotice>
      </div>
    );

  const rows = list.data?.data ?? [];
  const first = list.page * PAGE_SIZE + 1;
  return (
    <div className="np-stack np-stack--lg" ref={root}>
      {header}
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} title="We couldn't load payment links" />
      ) : !list.loading && rows.length === 0 && list.page === 0 && filter === "all" ? (
        <EmptyState
          title={app.mode === "test" ? "No test payment links yet" : "No payment links yet"}
          action={createBtn}
          footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
        >
          Create a link, share it anywhere, and every customer gets their own checkout.
        </EmptyState>
      ) : (
        <>
          <SegmentedControl
            label="Filter links"
            items={FILTERS}
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            size="sm"
          />
          <Table
            caption="Payment links"
            columns={columns}
            rows={rows}
            rowKey={(l) => l.id}
            rowHref={(l) => app.href(`/payment-links/${l.id}`)}
            loading={list.loading}
            empty="No links match this filter."
            footer={
              list.data && (list.data.has_more || list.page > 0) ? (
                <Pager
                  summary={rows.length ? `Showing ${first}–${first + rows.length - 1} links` : undefined}
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
      <Callout title="A fresh checkout for each customer">
        Payment links can be reused. Each visit creates a separate checkout with its own payment status.
      </Callout>
    </div>
  );
}
