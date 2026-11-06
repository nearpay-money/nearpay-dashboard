import { listPaymentIntents, startKyb } from "@nearpay/spec";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { useAsync } from "../../lib/hooks";
import { Badge, Button, Card, Empty, ErrorNote, Loading } from "../../ui/ui";
import { PaymentsTable } from "../payments/PaymentsList";

export function Home() {
  const app = useApp();
  const req = app.requirements;
  const [kyb, setKyb] = useState<string>();
  const [kybBusy, setKybBusy] = useState(false);
  const [kybError, setKybError] = useState<unknown>();
  const recent = useAsync(() => app.api.call(listPaymentIntents, { query: { limit: 5 } }), [app.api, app.mode]);
  const missing = new Set(req?.missing ?? []);
  const kybStatus = kyb ?? app.account?.kyb_status;

  return (
    <div className="page">
      <h1>Welcome{app.account ? `, ${app.account.display_name}` : ""}</h1>
      <Card
        title="Go live"
        actions={
          req && <Badge value={req.live_enabled ? "active" : "pending"} tone={req.live_enabled ? "ok" : "warn"} />
        }
      >
        {!req ? (
          <Loading />
        ) : (
          <ol className="checklist" data-testid="requirements">
            <li className={missing.has("kyb") ? "todo" : "done"}>
              <div>
                <strong>Verify your business (KYB)</strong>
                <p className="muted">
                  Live payments need an approved KYB review. Status: {kybStatus ? <Badge value={kybStatus} /> : "—"}
                </p>
              </div>
              {missing.has("kyb") && (
                <Button
                  variant="secondary"
                  busy={kybBusy}
                  blocked={app.gate(startKyb)}
                  onClick={async () => {
                    setKybBusy(true);
                    setKybError(undefined);
                    try {
                      const c = await app.api.call(startKyb, { body: {} });
                      setKyb(c.status);
                      app.refreshAccount();
                    } catch (e) {
                      setKybError(e);
                    } finally {
                      setKybBusy(false);
                    }
                  }}
                >
                  {kybStatus === "not_started" ? "Start verification" : "Check status"}
                </Button>
              )}
            </li>
            <li className={missing.has("destination") ? "todo" : "done"}>
              <div>
                <strong>Add a live settlement destination</strong>
                <p className="muted">
                  Where you receive funds: a NEAR Intents account or an address, proven with a wallet signature.
                </p>
              </div>
              {missing.has("destination") && (
                <a
                  className="btn btn-secondary"
                  href="/settlement/new?mode=live"
                  onClick={(e) => {
                    e.preventDefault();
                    app.navigate("/settlement/new?mode=live");
                  }}
                >
                  Add destination
                </a>
              )}
            </li>
            {missing.has("account_status") && (
              <li className="todo">
                <div>
                  <strong>Account under review</strong>
                  <p className="muted">Your account is not active. Contact support.</p>
                </div>
              </li>
            )}
            <li className={req.live_enabled ? "done" : "todo"}>
              <div>
                <strong>Live mode</strong>
                <p className="muted">
                  {req.live_enabled
                    ? "Enabled — live keys accept real payments."
                    : "Unlocks when the steps above are done."}
                </p>
              </div>
            </li>
          </ol>
        )}
        <ErrorNote error={kybError} />
      </Card>
      <Card title="Build in test mode">
        <ol className="steps">
          <li>
            <Link to="/settlement/new">Add a test destination</Link> (active immediately).
          </li>
          <li>
            <Link to="/developers">Create a test secret key</Link> for your server.
          </li>
          <li>
            <Link to="/developers/webhooks">Add a webhook endpoint</Link> and verify signatures with{" "}
            <code>@nearpay/node</code>.
          </li>
          <li>Create a checkout session from your server and pay it — it shows up below.</li>
        </ol>
      </Card>
      <Card title="Recent payments" actions={<Link to="/payments">View all</Link>}>
        {recent.loading && <Loading />}
        <ErrorNote error={recent.error} />
        {recent.data &&
          (recent.data.data.length ? (
            <PaymentsTable intents={recent.data.data} />
          ) : (
            <Empty>No payments in {app.mode} mode yet.</Empty>
          ))}
      </Card>
    </div>
  );
}
