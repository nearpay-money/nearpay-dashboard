import { getAgentPayment, listAgentPayments } from "@nearpay/spec";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { explorerTxUrl } from "../../lib/explorer";
import { formatTime, shorten } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { formatAsset } from "../../lib/money";
import { Badge, Card, Empty, ErrorNote, KeyValue, Loading, Mono, Pager } from "../../ui/ui";

const KINDS = ["x402", "checkout", "refund"] as const;

function TxLink({ hash }: { hash: string | null }) {
  if (!hash) return <span className="muted">—</span>;
  const url = explorerTxUrl({ chain: "near:mainnet", tx_hash: hash });
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {shorten(hash, 8)} ↗
    </a>
  ) : (
    <Mono>{hash}</Mono>
  );
}

export function AgentPayments() {
  const app = useApp();
  const [kind, setKind] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors[cursors.length - 1];
  const page = useAsync(
    () =>
      app.api.call(listAgentPayments, {
        query: { limit: 20, ...(kind ? { kind } : {}), ...(after ? { starting_after: after } : {}) },
      }),
    [app.api, app.mode, kind, after],
  );
  return (
    <div className="page">
      <h1>Agent payments</h1>
      <p className="muted">
        Payer-signed NEAR Intents transfers relayed by NearPay: x402 resources and agents paying checkouts.
      </p>
      <Card
        actions={
          <label className="inline">
            Kind{" "}
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setCursors([]);
              }}
            >
              <option value="">All</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {page.loading && <Loading />}
        <ErrorNote error={page.error} />
        {page.data &&
          (page.data.data.length ? (
            <table className="table" data-testid="agent-payments-table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Payer</th>
                  <th>Transaction</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {page.data.data.map((p) => (
                  <tr key={p.id}>
                    <td className="num">
                      <Link to={`/agent-payments/${p.id}`}>{formatAsset(p.amount, p.asset_id, app.assets)}</Link>
                    </td>
                    <td>{p.kind}</td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td>
                      <Mono>{shorten(p.payer, 10)}</Mono>
                    </td>
                    <td>
                      <TxLink hash={p.tx_hash} />
                    </td>
                    <td>{formatTime(p.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No agent payments in {app.mode} mode yet.</Empty>
          ))}
        {page.data && (
          <Pager
            hasMore={page.data.has_more}
            canBack={cursors.length > 0}
            onNext={() => {
              const last = page.data?.data[page.data.data.length - 1];
              if (last) setCursors([...cursors, last.id]);
            }}
            onBack={() => setCursors(cursors.slice(0, -1))}
          />
        )}
      </Card>
    </div>
  );
}

export function AgentPaymentDetail({ id }: { id: string }) {
  const app = useApp();
  const ap = useAsync(() => app.api.call(getAgentPayment, { params: { id } }), [app.api, app.mode, id]);
  if (ap.loading) return <Loading />;
  const p = ap.data;
  if (!p) return <ErrorNote error={ap.error} />;
  return (
    <div className="page">
      <h1>
        {formatAsset(p.amount, p.asset_id, app.assets)} <Badge value={p.status} />
      </h1>
      <Card>
        <KeyValue
          rows={[
            ["ID", <Mono key="id">{p.id}</Mono>],
            ["Kind", p.kind],
            ["Payer", <Mono key="payer">{p.payer}</Mono>],
            ["Pay to", <Mono key="to">{p.pay_to}</Mono>],
            ["Fee", formatAsset(p.fee_amount, p.asset_id, app.assets)],
            ["Binding", <Mono key="b">{p.binding}</Mono>],
            ["Resource", p.resource_url ?? "—"],
            ["Checkout session", p.checkout_session ? <Mono key="cs">{p.checkout_session}</Mono> : "—"],
            ["Transaction", <TxLink key="tx" hash={p.tx_hash} />],
            ["Block", p.block_height === null ? "—" : String(p.block_height)],
            ["Settled", formatTime(p.settled_at)],
            ...(p.error_reason ? ([["Error", p.error_reason]] as [string, string][]) : []),
          ]}
        />
      </Card>
    </div>
  );
}
