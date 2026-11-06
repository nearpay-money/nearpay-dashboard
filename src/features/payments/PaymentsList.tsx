import { IntentStatus, listPaymentIntents, type PaymentIntent } from "@nearpay/spec";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatTime } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { formatPrice } from "../../lib/money";
import { Badge, Card, Empty, ErrorNote, Loading, Mono, Pager } from "../../ui/ui";

export function PaymentsTable({ intents }: { intents: readonly PaymentIntent[] }) {
  const app = useApp();
  return (
    <table className="table" data-testid="payments-table">
      <thead>
        <tr>
          <th>Amount</th>
          <th>Status</th>
          <th>Description</th>
          <th>Created</th>
          <th>ID</th>
        </tr>
      </thead>
      <tbody>
        {intents.map((pi) => (
          <tr key={pi.id}>
            <td className="num">
              <Link to={`/payments/${pi.id}`}>{formatPrice(pi, app.assets)}</Link>
            </td>
            <td>
              <Badge value={pi.status} />
              {pi.late && <Badge value="late" tone="warn" />}
            </td>
            <td>{pi.description ?? <span className="muted">—</span>}</td>
            <td>{formatTime(pi.created)}</td>
            <td>
              <Mono>{pi.id}</Mono>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PaymentsList() {
  const app = useApp();
  const [status, setStatus] = useState<string>("");
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors[cursors.length - 1];
  const page = useAsync(
    () =>
      app.api.call(listPaymentIntents, {
        query: { limit: 20, ...(status ? { status } : {}), ...(after ? { starting_after: after } : {}) },
      }),
    [app.api, app.mode, status, after],
  );
  return (
    <div className="page">
      <h1>Payments</h1>
      <Card
        actions={
          <label className="inline">
            Status{" "}
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setCursors([]);
              }}
            >
              <option value="">All</option>
              {IntentStatus.options.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
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
            <PaymentsTable intents={page.data.data} />
          ) : (
            <Empty>
              No payments{status ? ` with status ${status.replace(/_/g, " ")}` : ""} in {app.mode} mode.
            </Empty>
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
