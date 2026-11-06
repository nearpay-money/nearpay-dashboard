import { getEvent, listEvents, WEBHOOK_TYPE_NAMES } from "@nearpay/spec";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatTime } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { Card, Empty, ErrorNote, KeyValue, Loading, Mono, Pager } from "../../ui/ui";

export function Events() {
  const app = useApp();
  const [type, setType] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors[cursors.length - 1];
  const page = useAsync(
    () =>
      app.api.call(listEvents, {
        query: { limit: 25, ...(type ? { type } : {}), ...(after ? { starting_after: after } : {}) },
      }),
    [app.api, app.mode, type, after],
  );
  return (
    <Card
      title="Events (last 30 days)"
      actions={
        <label className="inline">
          Type{" "}
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setCursors([]);
            }}
          >
            <option value="">All</option>
            {WEBHOOK_TYPE_NAMES.map((t) => (
              <option key={t} value={t}>
                {t}
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
          <table className="table" data-testid="events-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Event</th>
                <th>Object</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {page.data.data.map((e) => {
                const obj = e.data.object as { id?: unknown; object?: unknown };
                return (
                  <tr key={e.id}>
                    <td>
                      <Link to={`/developers/events/${e.id}`}>{e.type}</Link>
                    </td>
                    <td>
                      <Mono>{e.id}</Mono>
                    </td>
                    <td>
                      <Mono>{typeof obj.id === "string" ? obj.id : String(obj.object ?? "")}</Mono>
                    </td>
                    <td>{formatTime(e.created)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>No events in {app.mode} mode.</Empty>
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
  );
}

export function EventDetail({ id }: { id: string }) {
  const app = useApp();
  const evt = useAsync(() => app.api.call(getEvent, { params: { id } }), [app.api, app.mode, id]);
  if (evt.loading) return <Loading />;
  if (!evt.data) return <ErrorNote error={evt.error} />;
  const e = evt.data;
  return (
    <Card title={e.type}>
      <KeyValue
        rows={[
          ["ID", <Mono key="id">{e.id}</Mono>],
          ["Created", formatTime(e.created)],
          ["API version", e.api_version],
          ["Request", e.request.id ? <Mono key="r">{e.request.id}</Mono> : "—"],
        ]}
      />
      <pre className="json" data-testid="event-json">
        {JSON.stringify(e, null, 2)}
      </pre>
    </Card>
  );
}
