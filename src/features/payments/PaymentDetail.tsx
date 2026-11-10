/**
 * Payment detail (Figma "Payment NP–10482"; mobile b04): Purchase / Fees / You received stats (gross, fees
 * and settlement stay separate), payment activity timeline, attempts with settlement evidence, the
 * Settlement card (destination, fingerprint computed client-side, "View transaction") and the Customer
 * card. "Refund payment" opens the refund flow of the refunds module (`/payments/:id/refund`).
 */
import {
  createRefund,
  getCheckoutSession,
  getPaymentIntent,
  listBalanceTransactions,
  type PaymentIntent,
} from "@nearpay/spec";
import {
  Callout,
  Card,
  CardTitle,
  ExternalLinkIcon,
  KeyValueList,
  StatusBadge,
  Table,
  Timeline,
  type TimelineItem,
} from "@nearpay-internal/ui";
import { type ComponentType, type ReactNode, Suspense, use, useEffect, useState } from "react";
import { Link, useApp } from "../../app/context";
import { loadArea } from "../../app/features";
import { networkName } from "../../lib/chains";
import { explorerAddressUrl, explorerTxUrl } from "../../lib/explorer";
import { destinationFingerprint } from "../../lib/fingerprint";
import { dayKey, formatClock, formatDate, formatIso, formatWhen, humanize, shorten, shortId } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { type AssetInfo, assetLabel, formatAsset, formatPrice, formatUnits } from "../../lib/money";
import { statusOf } from "../../lib/status";
import { ErrorState, LoadingState, Page, Section, StatRow } from "../../ui/page";
import { Badge, KeyValue, Mono } from "../../ui/ui";
import { paymentName } from "./shared";

type Attempt = PaymentIntent["attempts"][number];

/** Refunds of this payment (refunds area, loaded on demand). */
function PaymentRefunds({ paymentIntent }: { paymentIntent: PaymentIntent }) {
  const mod = use(loadArea("refunds")) as { PaymentRefunds?: ComponentType<{ paymentIntent: PaymentIntent }> };
  const C = mod.PaymentRefunds;
  return C ? <C paymentIntent={paymentIntent} /> : null;
}
type Evidence = NonNullable<Attempt["evidence"]>;

export function EvidenceLink({ evidence }: { evidence: Evidence }) {
  const url = explorerTxUrl(evidence);
  const label = shorten(evidence.tx_hash, 8);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" data-testid="evidence-link" className="dash-ext-link">
      {label}
      <ExternalLinkIcon size={14} />
      <span className="np-sr-only"> (opens a block explorer)</span>
    </a>
  ) : (
    <Mono>{label}</Mono>
  );
}

function when(unix: number, now: number): string {
  return dayKey(unix) === dayKey(now) ? formatClock(unix) : `${formatDate(unix)} ${formatClock(unix)}`;
}

/** Activity entries, newest first, from the intent's own timestamps and its attempts (no extra calls). */
export function activity(pi: PaymentIntent, assets: ReadonlyMap<string, AssetInfo>, now: number): TimelineItem[] {
  const items: (TimelineItem & { at: number })[] = [];
  const add = (at: number, id: string, title: string, body: ReactNode, state: TimelineItem["state"]) =>
    items.push({ at, id, time: when(at, now), dateTime: new Date(at * 1000).toISOString(), title, body, state });
  const settle = (amount: string | null) => (amount ? formatAsset(amount, pi.settlement_asset_id, assets) : "");
  add(
    pi.created,
    "created",
    pi.source === "checkout" ? "Checkout opened" : "Payment created",
    pi.description ?? undefined,
    "done",
  );
  for (const a of pi.attempts) {
    const token = `${assetLabel(a.origin_asset_id, assets)} on ${networkName(a.origin_chain)}`;
    add(a.created, `${a.id}-start`, "Payment started", `Payer chose ${token}.`, "done");
    if (a.evidence) {
      const at = Math.floor(Date.parse(a.evidence.observed_at) / 1000) || a.created;
      add(
        at,
        `${a.id}-funds`,
        "Funds received",
        `${settle(a.settled_amount ?? a.evidence.amount)} received at your destination.`,
        "done",
      );
    } else if (a.status === "expired_unpaid" || a.status === "failed") {
      add(
        a.deadline ?? a.created,
        `${a.id}-end`,
        a.status === "failed" ? "Attempt failed" : "Attempt expired",
        a.failure_code
          ? `${humanize(a.failure_code).replace(/^./, (c) => c.toUpperCase())}. No funds arrived for this attempt.`
          : "No funds arrived for this attempt.",
        "attention",
      );
    } else if (
      a.status === "settling" ||
      a.status === "verifying" ||
      a.status === "held" ||
      a.status === "incomplete_deposit"
    ) {
      add(a.created, `${a.id}-detected`, "Payment detected", `Confirming the ${token} payment.`, "pending");
    }
  }
  if (pi.succeeded_at)
    add(pi.succeeded_at, "complete", "Payment complete", "Settlement verified. Order can be fulfilled.", "done");
  if (pi.status === "requires_review")
    add(
      now,
      "review",
      "Needs review",
      `${humanize(pi.review_reason ?? "review")}. Check the evidence before fulfilling.`,
      "attention",
    );
  if (pi.canceled_at) add(pi.canceled_at, "canceled", "Payment canceled", pi.cancellation_reason ?? undefined, "info");
  if (pi.status === "requires_payment")
    add(now, "waiting", "Waiting for payment", "The payer hasn't paid yet.", "pending");
  return items.sort((x, y) => y.at - x.at).map(({ at: _at, ...i }) => i);
}

function AttemptsList({ intent }: { intent: PaymentIntent }) {
  const app = useApp();
  if (intent.attempts.length === 0) return <p className="np-text-secondary">No payment attempts yet.</p>;
  return (
    <ol className="dash-attempts" data-testid="attempts">
      {intent.attempts.map((a) => {
        const s = statusOf("attempt", a.status);
        return (
          <li key={a.id} className="dash-attempt">
            <div className="dash-attempt__head">
              <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
              <span>{a.method === "route_quote" ? "Deposit from any chain" : "NEAR Intents transfer"}</span>
              {a.is_overpayment ? <StatusBadge tone="warning">Overpayment</StatusBadge> : null}
              <span className="np-text-caption np-text-secondary">{formatWhen(a.created)}</span>
            </div>
            <KeyValue
              rows={[
                ["Attempt", <Mono key="id">{a.id}</Mono>],
                ["Paid with", `${assetLabel(a.origin_asset_id, app.assets)} on ${networkName(a.origin_chain)}`],
                [
                  "Expected settlement",
                  a.settlement_amount ? formatAsset(a.settlement_amount, intent.settlement_asset_id, app.assets) : "—",
                ],
                [
                  "Settled",
                  a.settled_amount ? formatAsset(a.settled_amount, intent.settlement_asset_id, app.assets) : "—",
                ],
                ["Deadline", formatWhen(a.deadline)],
                ...(a.failure_code ? ([["Reason", humanize(a.failure_code)]] as [string, string][]) : []),
                ...(a.evidence
                  ? ([
                      ["Evidence", <EvidenceLink key="ev" evidence={a.evidence} />],
                      [
                        "Verification",
                        `Tier ${a.evidence.tier} · ${a.evidence.finality} · ${a.evidence.source} · ${formatIso(a.evidence.observed_at)}`,
                      ],
                    ] as [string, ReactNode][])
                  : []),
              ]}
            />
          </li>
        );
      })}
    </ol>
  );
}

export function PaymentDetail({ id }: { id: string }) {
  const app = useApp();
  const pi = useAsync(() => app.api.call(getPaymentIntent, { params: { id } }), [app.api, app.mode, id]);
  const lines = useAsync(
    () => app.api.call(listBalanceTransactions, { query: { payment_intent: id, limit: 20 } }),
    [app.api, app.mode, id],
  );
  const [fingerprint, setFingerprint] = useState<string>();
  const intent = pi.data;
  const sessionId = intent?.checkout_session ?? null;
  const session = useAsync(
    () => (sessionId ? app.api.call(getCheckoutSession, { params: { id: sessionId } }) : Promise.resolve(undefined)),
    [app.api, app.mode, sessionId],
  );
  useEffect(() => {
    if (!intent) return;
    const d = intent.destination;
    void destinationFingerprint(d.chain, d.address, d.asset_id).then(setFingerprint, () => setFingerprint(undefined));
  }, [intent]);

  if (pi.loading && !intent) return <LoadingState what="Loading payment" stats={3} />;
  if (!intent) return <ErrorState title="Payment" error={pi.error} onRetry={pi.reload} />;

  const now = Math.floor(Date.now() / 1000);
  const d = intent.destination;
  const addrUrl = explorerAddressUrl(d.chain, d.address);
  const settleAsset = app.assets.get(intent.settlement_asset_id);
  const status = statusOf("payment", intent.status);
  const payment = lines.data?.data.find((l) => l.type === "payment");
  const fee = payment?.fee;
  const evidence = [...intent.attempts].reverse().find((a) => a.evidence)?.evidence ?? payment?.evidence ?? null;
  const txUrl = evidence ? explorerTxUrl(evidence) : null;
  const refundable =
    BigInt(intent.amount_settled) - BigInt(intent.amount_refunded) - BigInt(intent.amount_refund_pending ?? "0");
  const canRefund =
    intent.status === "succeeded" && refundable > 0n && app.registry.hasPath(`/payments/${intent.id}/refund`);
  const refundBlocked = app.gate(createRefund);
  const customersRoute = intent.customer && app.registry.hasPath(`/customers/${intent.customer}`);
  // spec 0.2.1: what the payer sent (origin asset) and their refund address, from the paying attempt
  const paid =
    [...intent.attempts].reverse().find((a) => a.status === "succeeded" && a.origin_amount) ??
    [...intent.attempts].reverse().find((a) => a.origin_amount);
  const payer = [...intent.attempts].reverse().find((a) => a.refund_to);
  const feeText = fee ? formatAsset(fee.amount_estimated, fee.asset_id, app.assets) : `${intent.fee.total_bps} bps`;

  return (
    <Page
      title={`Payment ${shortId(intent.id)}`}
      subtitle={`${paymentName(intent)} · Created ${formatDate(intent.created)} at ${formatClock(intent.created).slice(0, 5)}`}
      status={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      back={{ label: "Payments", to: "/payments" }}
      actions={
        canRefund ? (
          refundBlocked ? (
            <span
              className="np-button np-button--secondary dash-button--disabled"
              aria-disabled="true"
              title={refundBlocked}
            >
              Refund payment
            </span>
          ) : (
            <Link to={`/payments/${intent.id}/refund`} className="np-button np-button--secondary">
              <span>Refund payment</span>
            </Link>
          )
        ) : undefined
      }
    >
      {intent.status === "requires_review" && (
        <Callout tone="warning" title={`Needs review: ${humanize(intent.review_reason ?? "unknown")}`}>
          NearPay holds no funds. Check the evidence below before you fulfil the order.
        </Callout>
      )}
      <StatRow
        items={[
          { label: "Purchase", value: formatPrice(intent, app.assets), sub: status.label },
          paid?.origin_amount
            ? {
                label: "Payer sent",
                value: formatAsset(paid.origin_amount, paid.origin_asset_id, app.assets),
                sub: `${networkName(paid.origin_chain)} · fee ${feeText} ${intent.fee.bearer === "payer" ? "paid by the payer" : "deducted from your settlement"}`,
              }
            : {
                label: "Payment fee",
                value: feeText,
                sub: `${fee ? `${intent.fee.total_bps} bps · ` : ""}${intent.fee.bearer === "payer" ? "Paid by the payer" : "Deducted from your settlement"}`,
              },
          {
            label: "You received",
            value: formatAsset(intent.amount_settled, intent.settlement_asset_id, app.assets),
            sub:
              intent.amount_refunded !== "0"
                ? `${formatAsset(intent.amount_refunded, intent.settlement_asset_id, app.assets)} refunded`
                : `${networkName(d.chain)} · ${shorten(d.address, 6)}`,
          },
        ]}
      />
      <div className="dash-detail">
        <div className="dash-detail__main">
          <Section title="Payment activity">
            <Timeline items={activity(intent, app.assets, now)} />
          </Section>
          {intent.status === "succeeded" || (intent.refunds?.length ?? 0) > 0 ? (
            <Suspense fallback={null}>
              <PaymentRefunds paymentIntent={intent} />
            </Suspense>
          ) : null}
          <Section title="Payment attempts" level={3}>
            <AttemptsList intent={intent} />
          </Section>
          {intent.overpayments.length > 0 && (
            <Callout tone="warning" title="Overpayment received — a refund is recommended">
              <ul>
                {intent.overpayments.map((o) => (
                  <li key={o.attempt}>
                    {formatAsset(o.amount, intent.settlement_asset_id, app.assets)} — {humanize(o.reason)} (
                    <Mono>{o.attempt}</Mono>)
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          <Section title="Statement" level={3}>
            {lines.error ? <p className="np-text-secondary">The statement couldn't be loaded.</p> : null}
            <div data-testid="statement">
              <Table
                caption="Statement lines"
                loading={lines.loading && !lines.data}
                rows={lines.data?.data ?? []}
                rowKey={(l) => l.id}
                empty="No settlement recorded yet."
                columns={[
                  {
                    key: "type",
                    header: "Type",
                    cell: (l) => humanize(l.type).replace(/^./, (c) => c.toUpperCase()),
                    primary: true,
                  },
                  { key: "settled", header: "Settled", cell: (l) => l.settled.display, numeric: true },
                  { key: "fee", header: "Fee", cell: (l) => (l.fee ? `${l.fee.bps} bps` : "—"), hideOnNarrow: true },
                  {
                    key: "ev",
                    header: "Evidence",
                    cell: (l) => <EvidenceLink evidence={l.evidence} />,
                    hideOnNarrow: true,
                  },
                  { key: "at", header: "Recorded", cell: (l) => formatWhen(l.created), hideOnNarrow: true },
                ]}
              />
            </div>
          </Section>
        </div>
        <Card as="aside" className="dash-detail__card" aria-label="Settlement and customer">
          <div className="np-stack np-stack--lg">
            <CardTitle>Settlement</CardTitle>
            <KeyValueList
              className="dash-kv-strong"
              items={[
                {
                  label: "Asset / network",
                  value: `${settleAsset?.symbol ?? assetLabel(d.asset_id, app.assets)} / ${networkName(d.chain)}`,
                },
                {
                  label: d.type === "intents_account" ? "Intents account" : "Address",
                  value: <span className="dash-break">{d.address}</span>,
                },
                { label: "Fingerprint", value: <Mono>{fingerprint ?? "…"}</Mono> },
              ]}
            />
            <div className="np-stack np-stack--sm">
              {txUrl ? (
                <a
                  href={txUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="np-button np-button--secondary np-button--full"
                >
                  <span>View transaction</span>
                  <ExternalLinkIcon size={16} />
                </a>
              ) : (
                <p className="np-text-caption np-text-secondary">
                  The transaction link appears once settlement is verified.
                </p>
              )}
              {addrUrl ? (
                <a href={addrUrl} target="_blank" rel="noopener noreferrer" className="np-link-button">
                  View destination on explorer
                </a>
              ) : null}
            </div>
            <CardTitle>Customer</CardTitle>
            <div className="np-stack np-stack--sm">
              {intent.customer ? (
                customersRoute ? (
                  <Link to={`/customers/${intent.customer}`}>{shortId(intent.customer)}</Link>
                ) : (
                  <Mono>{intent.customer}</Mono>
                )
              ) : (
                <p>Guest checkout</p>
              )}
              <p className="np-text-caption np-text-secondary">
                {intent.customer
                  ? "Customer record attached"
                  : "No customer record. Payers don't need an account or email."}
              </p>
              {payer?.refund_to ? (
                <p className="np-text-small" data-testid="payer-address">
                  Payer address <Mono title={payer.refund_to}>{shorten(payer.refund_to, 6)}</Mono> ·{" "}
                  {networkName(payer.origin_chain)}
                  <span className="np-text-caption np-text-secondary dash-block">
                    Given at checkout; refunds return here.
                  </span>
                </p>
              ) : null}
              {session.data ? (
                <p className="np-text-caption np-text-secondary">
                  Checkout session {shortId(session.data.id)} · <Badge kind="session" value={session.data.status} />
                </p>
              ) : null}
            </div>
            <CardTitle as="h3">Details</CardTitle>
            <KeyValueList
              items={[
                { label: "Payment ID", value: <Mono>{intent.id}</Mono> },
                { label: "Mode", value: intent.livemode ? "Live" : "Test" },
                { label: "Source", value: humanize(intent.source).replace(/^./, (c) => c.toUpperCase()) },
                { label: "Late settlement", value: intent.late ? "Yes, after the session expired" : "No" },
                ...(settleAsset
                  ? [
                      {
                        label: "Refunded",
                        value: `${formatUnits(intent.amount_refunded, settleAsset.decimals)} ${settleAsset.symbol}`,
                      },
                    ]
                  : []),
                ...Object.entries(intent.metadata ?? {}).map(([k, v]) => ({ label: k, value: String(v) })),
              ]}
            />
          </div>
        </Card>
      </div>
      <p className="np-text-caption np-text-secondary">
        Funds settle directly to your chosen wallet. NearPay does not hold your balance.
      </p>
    </Page>
  );
}
