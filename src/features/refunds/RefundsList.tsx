/**
 * Refund lists: `PaymentRefunds` (card for the payment detail page: refunds of one payment +
 * "Refund payment") and the `/refunds` page (all refunds, status filter, cursor pager).
 */
import { createRefund, type PaymentIntent, type Refund } from "@nearpay/spec";
import {
  buttonClassName,
  Card,
  CardTitle,
  EmptyState,
  Money,
  PageHeader,
  Pager,
  SegmentedControl,
  StatusBadge,
  Table,
  type TableColumn,
} from "@nearpay-internal/ui";
import { useRef, useState } from "react";
import { useApp } from "../../app/context";
import { PAGE_SIZE, useRefundList } from "./api";
import { canRefund, refundableAmount, refundBadge, shortRef } from "./logic";
import { ErrorState } from "./parts";
import { fmtDate, useSpaLinks } from "./ui";
import "./refunds.css";

function useColumns(withPayment: boolean): TableColumn<Refund>[] {
  const app = useApp();
  return [
    { key: "id", header: "Refund", primary: true, cell: (r) => shortRef("RF", r.id) },
    ...(withPayment
      ? [{ key: "pi", header: "Payment", cell: (r: Refund) => shortRef("NP", r.payment_intent), hideOnNarrow: true }]
      : []),
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      cell: (r) => <Money amount={r.amount} decimals={r.decimals} symbol={app.assets.get(r.asset_id)?.symbol ?? ""} />,
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge>{refundBadge(r.status)}</StatusBadge> },
    { key: "created", header: "Created", hideOnNarrow: true, cell: (r) => fmtDate(r.created) },
  ];
}

/** Refunds of one payment, for the payment detail page. */
export function PaymentRefunds({ paymentIntent }: { paymentIntent: PaymentIntent }) {
  const app = useApp();
  const list = useRefundList({ payment_intent: paymentIntent.id });
  const columns = useColumns(false);
  const root = useRef<HTMLDivElement>(null);
  useSpaLinks(root);
  const available = refundableAmount(paymentIntent);
  const blocked = app.gate(createRefund);
  const refundable = canRefund(paymentIntent) && available > 0n && !blocked;
  return (
    <Card as="section" aria-labelledby="npf-payment-refunds" ref={root}>
      <div className="np-stack">
        <div className="npf-refunds__card-head">
          <CardTitle as="h2">
            <span id="npf-payment-refunds">Refunds</span>
          </CardTitle>
          {refundable && (
            <a
              href={app.href(`/payments/${paymentIntent.id}/refund`)}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
              data-testid="refund-payment"
            >
              Refund payment
            </a>
          )}
        </div>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} title="We couldn't load refunds" />
        ) : (
          <Table
            caption={`Refunds of payment ${shortRef("NP", paymentIntent.id)}`}
            columns={columns}
            rows={list.data?.data ?? []}
            rowKey={(r) => r.id}
            rowHref={(r) => app.href(`/refunds/${r.id}`)}
            loading={list.loading}
            loadingRows={1}
            empty="No refunds for this payment."
            footer={
              list.data && (list.data.has_more || list.page > 0) ? (
                <Pager
                  hasPrevious={list.page > 0}
                  hasNext={list.data.has_more}
                  onPrevious={list.previous}
                  onNext={list.next}
                />
              ) : undefined
            }
          />
        )}
      </div>
    </Card>
  );
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "requires_action", label: "Not submitted" },
  { id: "pending", label: "Pending" },
  { id: "succeeded", label: "Refunded" },
  { id: "failed", label: "Failed" },
  { id: "canceled", label: "Canceled" },
] as const;

/** `/refunds`: every refund in the current mode. */
export function RefundsPage() {
  const app = useApp();
  const [filter, setFilter] = useState<string>("all");
  const list = useRefundList(filter === "all" ? {} : { status: filter });
  const columns = useColumns(true);
  const root = useRef<HTMLDivElement>(null);
  useSpaLinks(root);
  const rows = list.data?.data ?? [];
  const first = list.page * PAGE_SIZE + 1;
  return (
    <div className="np-stack np-stack--lg" ref={root}>
      <PageHeader title="Refunds" subtitle="Returns to payers, authorized from your settlement wallet." />
      <SegmentedControl label="Filter by status" items={FILTERS} value={filter} onChange={setFilter} size="sm" />
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} title="We couldn't load refunds" />
      ) : !list.loading && rows.length === 0 && list.page === 0 ? (
        <EmptyState
          title={filter === "all" ? "No refunds yet" : "No refunds with this status"}
          action={
            <a href={app.href("/payments")} className={buttonClassName({ variant: "secondary" })}>
              Go to payments
            </a>
          }
          footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
        >
          Refund a paid payment from its detail page. You approve every return in your wallet.
        </EmptyState>
      ) : (
        <Table
          caption="Refunds"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowHref={(r) => app.href(`/refunds/${r.id}`)}
          loading={list.loading}
          footer={
            list.data ? (
              <Pager
                summary={rows.length ? `Showing ${first}–${first + rows.length - 1} refunds` : undefined}
                hasPrevious={list.page > 0}
                hasNext={list.data.has_more}
                onPrevious={list.previous}
                onNext={list.next}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
