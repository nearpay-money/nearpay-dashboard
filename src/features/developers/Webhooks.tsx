import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookEndpointDeliveries,
  listWebhookEndpoints,
  testWebhookEndpoint,
  updateWebhookEndpoint,
  WEBHOOK_TYPE_NAMES,
} from "@nearpay/spec";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatTime, relative } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  KeyValue,
  Loading,
  Modal,
  Mono,
  Note,
  Pager,
  SecretOnce,
} from "../../ui/ui";

const SELECTABLE = WEBHOOK_TYPE_NAMES.filter((t) => t !== "ping");

export function Webhooks() {
  const app = useApp();
  const list = useAsync(() => app.api.call(listWebhookEndpoints, { query: { limit: 100 } }), [app.api, app.mode]);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [all, setAll] = useState(false);
  const [events, setEvents] = useState<string[]>(["payment_intent.succeeded"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [secret, setSecret] = useState<string>();

  return (
    <Card
      title="Webhook endpoints"
      actions={
        <Button blocked={app.gate(createWebhookEndpoint)} onClick={() => setOpen(true)}>
          Add endpoint
        </Button>
      }
    >
      <p className="muted">
        Deliveries are signed (<code>NearPay-Signature</code>: HMAC <code>v1</code> + Ed25519 <code>v1a</code>) and
        retried for 72 h. Verify them with <code>webhooks.constructEvent</code> from <code>@nearpay/node</code>.
      </p>
      {secret && <SecretOnce label="Signing secret" value={secret} />}
      {list.loading && <Loading />}
      <ErrorNote error={list.error} />
      {list.data &&
        (list.data.data.length ? (
          <table className="table" data-testid="endpoints-table">
            <thead>
              <tr>
                <th>URL</th>
                <th>Events</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/developers/webhooks/${e.id}`}>{e.url}</Link>
                  </td>
                  <td>{e.enabled_events.includes("*") ? "all events" : `${e.enabled_events.length} event type(s)`}</td>
                  <td>
                    <Badge value={e.status} />
                  </td>
                  <td>{formatTime(e.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No {app.mode} endpoints yet.</Empty>
        ))}
      {open && (
        <Modal
          title={`Add a ${app.mode} endpoint`}
          onClose={() => setOpen(false)}
          footer={
            <Button
              busy={busy}
              disabled={!url || (!all && events.length === 0)}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  const ep = await app.api.call(createWebhookEndpoint, {
                    body: {
                      url: url.trim(),
                      enabled_events: (all ? ["*"] : events) as never,
                      ...(description.trim() ? { description: description.trim() } : {}),
                    },
                  });
                  setOpen(false);
                  setUrl("");
                  setSecret(ep.secret);
                  list.reload();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add endpoint
            </Button>
          }
        >
          <Field label="Endpoint URL" hint="HTTPS (http only for localhost in test mode).">
            {(id) => (
              <input
                id={id}
                type="url"
                placeholder="https://example.com/webhooks/nearpay"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Field>
          <Field label="Description">
            {(id) => (
              <input id={id} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <fieldset className="events">
            <legend>Events</legend>
            <label>
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All events
            </label>
            {!all &&
              SELECTABLE.map((t) => (
                <label key={t}>
                  <input
                    type="checkbox"
                    checked={events.includes(t)}
                    onChange={(e) => setEvents(e.target.checked ? [...events, t] : events.filter((x) => x !== t))}
                  />{" "}
                  {t}
                </label>
              ))}
          </fieldset>
          <ErrorNote error={error} />
        </Modal>
      )}
    </Card>
  );
}

export function WebhookDetail({ id }: { id: string }) {
  const app = useApp();
  const ep = useAsync(() => app.api.call(getWebhookEndpoint, { params: { id } }), [app.api, app.mode, id]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [ping, setPing] = useState<string>();

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };

  if (ep.loading) return <Loading />;
  const e = ep.data;
  if (!e) return <ErrorNote error={ep.error} />;
  const disabled = e.status === "disabled";
  return (
    <>
      <Card
        title={e.url}
        actions={
          <>
            <Button
              variant="secondary"
              busy={busy === "test"}
              blocked={app.gate(testWebhookEndpoint)}
              onClick={() =>
                void run("test", async () => {
                  const evt = await app.api.call(testWebhookEndpoint, { params: { id }, body: {} });
                  setPing(evt.id);
                })
              }
            >
              Send test event
            </Button>
            <Button
              variant="secondary"
              busy={busy === "toggle"}
              blocked={app.gate(updateWebhookEndpoint)}
              onClick={() =>
                void run("toggle", async () => {
                  await app.api.call(updateWebhookEndpoint, { params: { id }, body: { disabled: !disabled } });
                  ep.reload();
                })
              }
            >
              {disabled ? "Enable" : "Disable"}
            </Button>
            <Button
              variant="danger"
              busy={busy === "delete"}
              blocked={app.gate(deleteWebhookEndpoint)}
              onClick={() => {
                if (!window.confirm("Delete this endpoint? Pending deliveries stop.")) return;
                void run("delete", async () => {
                  await app.api.call(deleteWebhookEndpoint, { params: { id } });
                  app.navigate(app.href("/developers/webhooks"));
                });
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <KeyValue
          rows={[
            ["ID", <Mono key="id">{e.id}</Mono>],
            ["Status", <Badge key="s" value={e.status} />],
            ...(e.disabled_reason ? ([["Disabled because", e.disabled_reason]] as [string, string][]) : []),
            ["API version", e.api_version],
            ["Events", e.enabled_events.join(", ")],
            ["Description", e.description ?? "—"],
            ["Created", formatTime(e.created)],
          ]}
        />
        {ping && (
          <Note tone="ok">
            Test event <Mono>{ping}</Mono> queued for delivery.{" "}
            <Link to={`/developers/events/${ping}`}>View event</Link>
          </Note>
        )}
        <ErrorNote error={error} />
      </Card>
      <WebhookDeliveries endpointId={id} />
    </>
  );
}

/**
 * Delivery log of one endpoint (`GET /v1/webhook_endpoints/{id}/deliveries`, spec 0.1.5): last 30 days,
 * newest first, cursor-paginated like the other lists. Unknown statuses render as received.
 */
export function WebhookDeliveries({ endpointId }: { endpointId: string }) {
  const app = useApp();
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors[cursors.length - 1];
  const page = useAsync(
    () =>
      app.api.call(listWebhookEndpointDeliveries, {
        params: { id: endpointId },
        query: { limit: 20, ...(after ? { starting_after: after } : {}) },
      }),
    [app.api, app.mode, endpointId, after],
  );
  return (
    <Card
      title="Deliveries"
      actions={
        <Button variant="secondary" onClick={page.reload}>
          Refresh
        </Button>
      }
    >
      <p className="muted">
        Every event sent to this endpoint in the last 30 days, newest first. Failed deliveries are retried with backoff
        for 72 h, then abandoned.
      </p>
      {page.loading && <Loading />}
      <ErrorNote error={page.error} />
      {page.data &&
        (page.data.data.length ? (
          <table className="table" data-testid="deliveries-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last response</th>
                <th>Next attempt</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {page.data.data.map((d) => (
                <tr key={d.id} data-testid={`delivery-${d.id}`}>
                  <td>
                    <Link to={`/developers/events/${d.event}`}>{d.event_type}</Link>
                    <br />
                    <Mono>{d.event}</Mono>
                  </td>
                  <td>
                    <Badge value={d.status} />
                  </td>
                  <td className="num">{d.attempts}</td>
                  <td>
                    {d.last_status_code !== null ? <Mono>HTTP {d.last_status_code}</Mono> : null}
                    {d.last_error ? <span className="muted"> {d.last_error}</span> : null}
                    {d.last_status_code === null && !d.last_error ? "—" : null}
                  </td>
                  <td>{d.next_attempt_at ? relative(d.next_attempt_at) : "—"}</td>
                  <td>{formatTime(d.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{cursors.length ? "No more deliveries." : "No deliveries in the last 30 days."}</Empty>
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
