import { getCheckoutSession, getPaymentIntent, listBalanceTransactions, type PaymentIntent } from "@nearpay/spec";
import { type ReactNode, useEffect, useState } from "react";
import { useApp } from "../../app/context";
import { explorerAddressUrl, explorerTxUrl } from "../../lib/explorer";
import { destinationFingerprint } from "../../lib/fingerprint";
import { formatIso, formatTime, humanize, shorten } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { assetLabel, formatAsset, formatPrice } from "../../lib/money";
import { Badge, Card, Empty, ErrorNote, KeyValue, Loading, Mono } from "../../ui/ui";

type Attempt = PaymentIntent["attempts"][number];
type Evidence = NonNullable<Attempt["evidence"]>;

export function EvidenceLink({ evidence }: { evidence: Evidence }) {
  const url = explorerTxUrl(evidence);
  const label = shorten(evidence.tx_hash, 8);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" data-testid="evidence-link">
      {label} ↗
    </a>
  ) : (
    <Mono>{label}</Mono>
  );
}

function AttemptsTimeline({ intent }: { intent: PaymentIntent }) {
  const app = useApp();
  if (intent.attempts.length === 0) return <Empty>No payment attempts yet.</Empty>;
  return (
    <ol className="timeline" data-testid="attempts">
      {intent.attempts.map((a) => (
        <li key={a.id} className={`tl-${a.status}`}>
          <div className="tl-head">
            <Badge value={a.status} />
            <span>{a.method === "route_quote" ? "Deposit from any chain" : "NEAR Intents transfer"}</span>
            {a.is_overpayment && <Badge value="overpayment" tone="warn" />}
            <span className="muted">{formatTime(a.created)}</span>
          </div>
          <KeyValue
            rows={[
              ["Attempt", <Mono key="id">{a.id}</Mono>],
              ["Paid with", `${assetLabel(a.origin_asset_id, app.assets)} on ${a.origin_chain}`],
              [
                "Expected settlement",
                a.settlement_amount ? formatAsset(a.settlement_amount, intent.settlement_asset_id, app.assets) : "—",
              ],
              [
                "Settled",
                a.settled_amount ? formatAsset(a.settled_amount, intent.settlement_asset_id, app.assets) : "—",
              ],
              ["Deadline", formatTime(a.deadline)],
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
      ))}
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

  if (pi.loading) return <Loading />;
  if (!intent) return <ErrorNote error={pi.error} />;
  const d = intent.destination;
  const addrUrl = explorerAddressUrl(d.chain, d.address);
  return (
    <div className="page">
      <h1>
        {formatPrice(intent, app.assets)} <Badge value={intent.status} />
      </h1>
      <p className="muted">
        <Mono>{intent.id}</Mono> · {intent.livemode ? "live" : "test"} · created {formatTime(intent.created)}
      </p>
      {intent.status === "requires_review" && (
        <div className="note note-warn">
          Needs review: {humanize(intent.review_reason ?? "unknown")}. NearPay holds no funds; check the evidence below.
        </div>
      )}
      <div className="grid-2">
        <Card title="Payment">
          <KeyValue
            rows={[
              ["Description", intent.description ?? "—"],
              ["Source", intent.source],
              ["Settled", formatAsset(intent.amount_settled, intent.settlement_asset_id, app.assets)],
              ["Refunded", formatAsset(intent.amount_refunded, intent.settlement_asset_id, app.assets)],
              ["Fee", `${intent.fee.total_bps} bps · paid by ${intent.fee.bearer}`],
              ["Succeeded", formatTime(intent.succeeded_at)],
              ["Late settlement", intent.late ? "yes (after the session expired)" : "no"],
              ...(intent.canceled_at
                ? ([["Canceled", `${formatTime(intent.canceled_at)} — ${intent.cancellation_reason ?? ""}`]] as [
                    string,
                    string,
                  ][])
                : []),
            ]}
          />
        </Card>
        <Card title="Settles to">
          <KeyValue
            rows={[
              ["Asset", `${assetLabel(d.asset_id, app.assets)} (${d.asset_id})`],
              ["Network", d.chain],
              [
                d.type === "intents_account" ? "Intents account" : "Address",
                addrUrl ? (
                  <a key="a" href={addrUrl} target="_blank" rel="noopener noreferrer">
                    {d.address} ↗
                  </a>
                ) : (
                  <Mono key="a">{d.address}</Mono>
                ),
              ],
              ["Fingerprint", <Mono key="f">{fingerprint ?? "…"}</Mono>],
              ["Destination", <Mono key="sd">{d.settlement_destination}</Mono>],
            ]}
          />
          {session.data && (
            <p className="muted">
              Checkout session <Mono>{session.data.id}</Mono> · <Badge value={session.data.status} /> · expires{" "}
              {formatTime(session.data.expires_at)}
            </p>
          )}
        </Card>
      </div>
      <Card title="Attempts">
        <AttemptsTimeline intent={intent} />
      </Card>
      {intent.overpayments.length > 0 && (
        <Card title="Overpayments (refund recommended)">
          <ul>
            {intent.overpayments.map((o) => (
              <li key={o.attempt}>
                {formatAsset(o.amount, intent.settlement_asset_id, app.assets)} — {humanize(o.reason)} (
                <Mono>{o.attempt}</Mono>)
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Statement lines">
        <ErrorNote error={lines.error} />
        {lines.data &&
          (lines.data.data.length ? (
            <table className="table" data-testid="statement">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Settled</th>
                  <th>Fee</th>
                  <th>Evidence</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {lines.data.data.map((l) => (
                  <tr key={l.id}>
                    <td>{humanize(l.type)}</td>
                    <td className="num">{l.settled.display}</td>
                    <td>{l.fee ? `${l.fee.bps} bps` : "—"}</td>
                    <td>
                      <EvidenceLink evidence={l.evidence} />
                    </td>
                    <td>{formatTime(l.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No settlement recorded yet.</Empty>
          ))}
      </Card>
    </div>
  );
}
