import {
  disableSettlementDestination,
  listSettlementDestinations,
  type SettlementDestination,
  setDefaultSettlementDestination,
} from "@nearpay/spec";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatTime, relative, shorten } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { assetLabel, formatFiat } from "../../lib/money";
import { Badge, Button, Card, Empty, ErrorNote, Loading, Mono } from "../../ui/ui";

function Status({ d }: { d: SettlementDestination }) {
  return (
    <div>
      <Badge value={d.status} />
      {d.status === "cooling_off" && d.active_at && (
        <div className="muted small" data-testid="cooloff">
          active {relative(d.active_at)} ({formatTime(d.active_at)})
        </div>
      )}
    </div>
  );
}

export function Destinations() {
  const app = useApp();
  const list = useAsync(() => app.api.call(listSettlementDestinations, { query: { limit: 100 } }), [app.api, app.mode]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      list.reload();
      app.refreshAccount();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="page">
      <h1>Settlement destinations</h1>
      <p className="muted">
        NearPay never holds funds: payments settle directly to these destinations. New live destinations need a wallet
        signature and a cool-off before they receive payments; payers see the fingerprint at checkout.
      </p>
      <Card
        actions={
          <Link to="/settlement/new" className="btn btn-primary">
            Add destination
          </Link>
        }
      >
        <ErrorNote error={error} />
        {list.loading && <Loading />}
        <ErrorNote error={list.error} />
        {list.data &&
          (list.data.data.length ? (
            <table className="table" data-testid="destinations-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Asset · network</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Fingerprint</th>
                  <th>Minimum</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((d) => (
                  <tr key={d.id} data-testid={`destination-${d.id}`}>
                    <td>
                      {d.label} {d.is_default && <Badge value="default" tone="info" />}
                      <div className="muted small">
                        {d.verification === "unverified" ? "unverified (capped)" : d.verification}
                      </div>
                    </td>
                    <td>
                      {assetLabel(d.asset_id, app.assets)} · {d.chain}
                      <div className="muted small">
                        {d.type === "intents_account" ? "NEAR Intents account" : "Address"}
                      </div>
                    </td>
                    <td>
                      <Mono>{shorten(d.address, 10)}</Mono>
                    </td>
                    <td>
                      <Status d={d} />
                    </td>
                    <td>
                      <Mono>{d.fingerprint}</Mono>
                    </td>
                    <td>{d.min_payment_amount ? formatFiat(d.min_payment_amount.amount, "usd") : "—"}</td>
                    <td className="row-actions">
                      {d.status === "pending_verification" && (
                        <Link to={`/settlement/${d.id}/attest`} className="btn btn-secondary">
                          Sign
                        </Link>
                      )}
                      {d.status === "active" && !d.is_default && (
                        <Button
                          variant="secondary"
                          busy={busy === `default-${d.id}`}
                          blocked={app.gate(setDefaultSettlementDestination)}
                          onClick={() =>
                            act(`default-${d.id}`, () =>
                              app.api.call(setDefaultSettlementDestination, {
                                params: { id: d.id },
                                body: { scope: "asset" },
                              }),
                            )
                          }
                        >
                          Make default
                        </Button>
                      )}
                      {d.status !== "disabled" && (
                        <Button
                          variant="danger"
                          busy={busy === `disable-${d.id}`}
                          blocked={app.gate(disableSettlementDestination)}
                          onClick={() => {
                            if (!window.confirm(`Disable ${d.label}? Existing payments keep their destination.`))
                              return;
                            void act(`disable-${d.id}`, () =>
                              app.api.call(disableSettlementDestination, { params: { id: d.id }, body: {} }),
                            );
                          }}
                        >
                          Disable
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No destinations in {app.mode} mode yet.</Empty>
          ))}
      </Card>
    </div>
  );
}
