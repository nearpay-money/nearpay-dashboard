/** Payment display pieces shared by Overview, the payments list and detail. */
import type { PaymentIntent } from "@nearpay/spec";
import { Money, StatusBadge, Table, type TableColumn } from "@nearpay-internal/ui";
import type { ReactNode } from "react";
import { Link, useApp } from "../../app/context";
import { networkName } from "../../lib/chains";
import { formatWhen, shortId } from "../../lib/format";
import { type AssetInfo, formatPrice, formatUnits } from "../../lib/money";
import { statusOf } from "../../lib/status";

export function PaymentStatus({ intent }: { intent: Pick<PaymentIntent, "status" | "late"> }) {
  const s = statusOf("payment", intent.status);
  return (
    <span className="dash-badges">
      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      {intent.late ? <StatusBadge tone="warning">Late</StatusBadge> : null}
    </span>
  );
}

/** Name of a payment in lists: its description, or a short id. */
export function paymentName(pi: Pick<PaymentIntent, "id" | "description">): string {
  return pi.description?.trim() || `Payment ${shortId(pi.id)}`;
}

/** What reached the merchant's destination ("2.000017 USDC · NEAR"), or why nothing did yet. */
export function settlementText(pi: PaymentIntent, assets: ReadonlyMap<string, AssetInfo>): ReactNode {
  const a = assets.get(pi.settlement_asset_id);
  if (pi.amount_settled !== "0" && a) {
    return (
      <>
        <Money amount={pi.amount_settled} decimals={a.decimals} symbol={a.symbol} minFraction={2} />
        {` · ${networkName(pi.destination.chain)}`}
      </>
    );
  }
  if (pi.amount_settled !== "0") return `${pi.amount_settled} base units`;
  if (pi.status === "processing") return <StatusBadge tone="warning">Pending</StatusBadge>;
  if (pi.status === "requires_review") return "Pending review";
  if (pi.status === "requires_payment") return "Awaiting payment";
  return "No settlement";
}

/** Plain-text settlement for CSV. */
export function settlementPlain(pi: PaymentIntent, assets: ReadonlyMap<string, AssetInfo>): [string, string] {
  const a = assets.get(pi.settlement_asset_id);
  return [a ? formatUnits(pi.amount_settled, a.decimals) : pi.amount_settled, a?.symbol ?? pi.settlement_asset_id];
}

export function customerText(pi: PaymentIntent): string {
  return pi.customer ? shortId(pi.customer) : "Guest";
}

/**
 * Payments as a table on wide screens and as the Figma mobile list (name + time / amount + status)
 * below 720 px. Both link to the detail page.
 */
export function PaymentsTable({
  intents,
  loading,
  empty,
  caption = "Payments",
  footer,
  compact,
}: {
  intents: readonly PaymentIntent[];
  loading?: boolean;
  empty?: ReactNode;
  caption?: string;
  footer?: ReactNode;
  /** Overview variant: Payment, Customer, Amount, Status, Received in. */
  compact?: boolean;
}) {
  const app = useApp();
  const now = Math.floor(Date.now() / 1000);
  const columns: TableColumn<PaymentIntent>[] = [
    {
      key: "payment",
      header: compact ? "Payment" : "Payment / created",
      primary: true,
      cell: (pi) => (
        <span className="dash-cell-main">
          <span>{paymentName(pi)}</span>
          <span className="dash-cell-sub"> · {formatWhen(pi.created, now)}</span>
        </span>
      ),
    },
    { key: "customer", header: "Customer", cell: customerText, hideOnNarrow: true },
    {
      key: "amount",
      header: compact ? "Amount" : "Purchase",
      numeric: true,
      cell: (pi) => formatPrice(pi, app.assets),
    },
    { key: "status", header: "Status", cell: (pi) => <PaymentStatus intent={pi} /> },
    {
      key: "settlement",
      header: compact ? "Received in" : "Settlement",
      hideOnNarrow: true,
      cell: (pi) =>
        compact
          ? `${app.assets.get(pi.settlement_asset_id)?.symbol ?? "—"} · ${networkName(pi.destination.chain)}`
          : settlementText(pi, app.assets),
    },
  ];
  return (
    <div data-testid="payments-table">
      <Table
        className="dash-wide-only"
        caption={caption}
        columns={columns}
        rows={intents}
        rowKey={(pi) => pi.id}
        rowHref={(pi) => app.href(`/payments/${pi.id}`)}
        loading={loading}
        empty={empty}
      />
      <ul className="dash-narrow-only dash-list" aria-label={caption}>
        {intents.map((pi) => (
          <li key={pi.id} className="dash-list__item">
            <Link to={`/payments/${pi.id}`} className="dash-list__link">
              <span className="dash-list__main">
                <span className="dash-list__title">{paymentName(pi)}</span>
                <span className="dash-list__sub">
                  {app.assets.get(pi.settlement_asset_id)?.symbol ?? ""} · {networkName(pi.destination.chain)} ·{" "}
                  {formatWhen(pi.created, now)}
                </span>
              </span>
              <span className="dash-list__end">
                <span className="dash-list__amount np-tabular">{formatPrice(pi, app.assets)}</span>
                <PaymentStatus intent={pi} />
              </span>
            </Link>
          </li>
        ))}
        {!loading && intents.length === 0 && empty ? <li className="dash-list__empty">{empty}</li> : null}
      </ul>
      {footer}
    </div>
  );
}
