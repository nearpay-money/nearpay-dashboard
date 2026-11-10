/** Payment display pieces shared by Overview, the payments list and detail. */
import type { PaymentIntent } from "@nearpay/spec";
import { Money, StatusBadge, Table, type TableColumn } from "@nearpay-internal/ui";
import type { ReactNode } from "react";
import { Link, useApp } from "../../app/context";
import { networkName } from "../../lib/chains";
import { formatWhen, shortId } from "../../lib/format";
import { type AssetInfo, assetLabel, formatPrice, formatUnits } from "../../lib/money";
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
  if (pi.status === "processing") return <StatusBadge tone="progress">Pending</StatusBadge>;
  if (pi.status === "requires_review") return "Pending review";
  if (pi.status === "requires_payment") return "Awaiting payment";
  return "No settlement";
}

/** Plain-text settlement for CSV. */
export function settlementPlain(pi: PaymentIntent, assets: ReadonlyMap<string, AssetInfo>): [string, string] {
  const a = assets.get(pi.settlement_asset_id);
  return [a ? formatUnits(pi.amount_settled, a.decimals) : pi.amount_settled, a?.symbol ?? pi.settlement_asset_id];
}

/** The attempt that paid the intent (not an overpayment), else the newest attempt. */
export function payingAttempt(pi: Pick<PaymentIntent, "attempts">): PaymentIntent["attempts"][number] | undefined {
  return (
    pi.attempts.find((a) => a.status === "succeeded" && !a.is_overpayment) ??
    pi.attempts.find((a) => a.status === "succeeded") ??
    pi.attempts[0]
  );
}

/** "USDC on Base" — what the customer paid with — or "Not chosen" before any attempt. */
export function paidWithText(pi: Pick<PaymentIntent, "attempts">, assets: ReadonlyMap<string, AssetInfo>): string {
  const a = payingAttempt(pi);
  if (!a) return "Not chosen";
  return `${assetLabel(a.origin_asset_id, assets)} on ${networkName(a.origin_chain)}`;
}

export function customerText(pi: PaymentIntent): string {
  return pi.customer ? shortId(pi.customer) : "Guest";
}

/**
 * Payments table v2 (design v2 "Recent payments"): Amount (bold, the row link — its accessible name also
 * carries the description), Status pill, Description, Paid with ("USDC on Base"), Date; the full list adds
 * Customer and what reached the payout wallet. Below 720 px the rows become the mobile list (description +
 * paid with + time / amount + status). Both link to the detail page.
 */
export function PaymentsTable({
  intents,
  loading,
  empty,
  caption = "Payments",
  footer,
  compact,
  title,
  actions,
}: {
  intents: readonly PaymentIntent[];
  loading?: boolean;
  empty?: ReactNode;
  caption?: string;
  footer?: ReactNode;
  /** Home variant: Amount, Status, Description, Paid with, Date. */
  compact?: boolean;
  /** Visible panel title ("Recent payments") and its actions ("View all"). */
  title?: ReactNode;
  actions?: ReactNode;
}) {
  const app = useApp();
  const now = Math.floor(Date.now() / 1000);
  const columns: TableColumn<PaymentIntent>[] = [
    {
      key: "amount",
      header: "Amount",
      primary: true,
      numeric: true,
      cell: (pi) => (
        <>
          {formatPrice(pi, app.assets)}
          <span className="np-sr-only"> · {paymentName(pi)}</span>
        </>
      ),
    },
    { key: "status", header: "Status", cell: (pi) => <PaymentStatus intent={pi} /> },
    { key: "description", header: "Description", cell: (pi) => paymentName(pi), className: "dash-cell-desc" },
    ...(compact ? [] : [{ key: "customer", header: "Customer", cell: customerText, hideOnNarrow: true, muted: true }]),
    {
      key: "paid-with",
      header: "Paid with",
      muted: true,
      hideOnNarrow: true,
      cell: (pi) => paidWithText(pi, app.assets),
    },
    ...(compact
      ? []
      : [
          {
            key: "settlement",
            header: "You received",
            hideOnNarrow: true,
            cell: (pi: PaymentIntent) => settlementText(pi, app.assets),
          },
        ]),
    { key: "date", header: "Date", muted: true, align: "end", cell: (pi) => formatWhen(pi.created, now) },
  ];
  return (
    <div data-testid="payments-table">
      <Table
        className="dash-wide-only"
        caption={caption}
        title={title}
        actions={actions}
        variant="flat"
        columns={columns}
        rows={intents}
        rowKey={(pi) => pi.id}
        rowHref={(pi) => app.href(`/payments/${pi.id}`)}
        loading={loading}
        empty={empty}
      />
      <div className="dash-narrow-only dash-list-panel">
        {title != null || actions ? (
          <div className="dash-list-panel__head">
            {title != null ? <h2 className="dash-card-title">{title}</h2> : <span />}
            {actions}
          </div>
        ) : null}
        <ul className="dash-list" aria-label={caption}>
          {intents.map((pi) => (
            <li key={pi.id} className="dash-list__item">
              <Link to={`/payments/${pi.id}`} className="dash-list__link">
                <span className="dash-list__main">
                  <span className="dash-list__title">{paymentName(pi)}</span>
                  <span className="dash-list__sub">
                    {paidWithText(pi, app.assets)} · {formatWhen(pi.created, now)}
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
      </div>
      {footer}
    </div>
  );
}
