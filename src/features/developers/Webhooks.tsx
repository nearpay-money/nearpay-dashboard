/**
 * Payment notifications = webhook endpoints (Figma Developers → Notifications): endpoints list, add (signing
 * secret shown once), endpoint page with test event, secret rotation with an overlap window
 * (`rotateWebhookEndpointSecret`, spec 0.2.0), enable/disable, delete, and the delivery log (20 per page,
 * cursor pager) with resend of a delivery's event to this endpoint (`resendEvent`, spec 0.2.0).
 */

import { Callout, Checkbox, Input, Select, StatusBadge, Table, useToast } from "@nearpay-internal/ui";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookEndpointDeliveries,
  listWebhookEndpoints,
  resendEvent,
  rotateWebhookEndpointSecret,
  testWebhookEndpoint,
  updateWebhookEndpoint,
  WEBHOOK_TYPE_NAMES,
  type WebhookDelivery as WebhookDeliverySchema,
  type WebhookEndpoint as WebhookEndpointSchema,
  type z,
} from "@nearpay-money/spec";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatTime, formatWhen, relative } from "../../lib/format";
import { useAsync, useCursorList, useMutation } from "../../lib/hooks";
import { statusOf } from "../../lib/status";
import { ConfirmDialog, ErrorState, LoadingState, Section, useConfirm } from "../../ui/page";
import { Badge, Button, ErrorNote, Field, KeyValue, Modal, Mono, Pager, SecretOnce } from "../../ui/ui";

type WebhookDelivery = z.output<typeof WebhookDeliverySchema>;
type WebhookEndpoint = z.output<typeof WebhookEndpointSchema>;

const SELECTABLE = WEBHOOK_TYPE_NAMES.filter((t) => t !== "ping");
const OVERLAP: [number, string][] = [
  [86_400, "24 hours (recommended)"],
  [3600, "1 hour"],
  [0, "Immediately"],
];

function eventsText(e: Pick<WebhookEndpoint, "enabled_events">): string {
  return e.enabled_events.includes("*")
    ? "All events"
    : `${e.enabled_events.length} event type${e.enabled_events.length === 1 ? "" : "s"}`;
}

function AddEndpoint({ onClose, onCreated }: { onClose(): void; onCreated(secret: string): void }) {
  const app = useApp();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [all, setAll] = useState(false);
  const [events, setEvents] = useState<string[]>(["payment_intent.succeeded"]);
  const create = useMutation(async () => {
    const ep = await app.api.call(createWebhookEndpoint, {
      body: {
        url: url.trim(),
        enabled_events: (all ? ["*"] : events) as never,
        ...(description.trim() ? { description: description.trim() } : {}),
      },
    });
    onCreated(ep.secret ?? "");
  });
  return (
    <Modal
      title={`Add a ${app.mode} endpoint`}
      description="NearPay sends signed events to this URL and retries failures for 72 hours."
      onClose={onClose}
      dismissible={!create.busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.busy}>
            Cancel
          </Button>
          <Button busy={create.busy} disabled={!url || (!all && events.length === 0)} onClick={() => void create.run()}>
            Add endpoint
          </Button>
        </>
      }
    >
      <div className="np-stack">
        <Field label="Endpoint URL" hint="HTTPS (http only for localhost in test mode).">
          {(id) => (
            <Input
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
            <Input id={id} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          )}
        </Field>
        <fieldset className="dash-events">
          <legend>Events to send</legend>
          <Checkbox label="All events" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {!all ? (
            <div className="dash-events__grid">
              {SELECTABLE.map((t) => (
                <Checkbox
                  key={t}
                  label={t}
                  checked={events.includes(t)}
                  onChange={(e) => setEvents(e.target.checked ? [...events, t] : events.filter((x) => x !== t))}
                />
              ))}
            </div>
          ) : null}
        </fieldset>
        <ErrorNote error={create.error} />
      </div>
    </Modal>
  );
}

export function Webhooks({ summary = false }: { summary?: boolean }) {
  const app = useApp();
  const list = useAsync(() => app.api.call(listWebhookEndpoints, { query: { limit: 100 } }), [app.api, app.mode]);
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string>();
  return (
    <Section
      title={summary ? "Payment notifications" : "Webhook endpoints"}
      actions={
        <Button
          variant={summary ? "secondary" : "primary"}
          blocked={app.gate(createWebhookEndpoint)}
          onClick={() => setOpen(true)}
        >
          Add endpoint
        </Button>
      }
    >
      {!summary ? (
        <p className="np-text-secondary">
          Deliveries are signed (<code>NearPay-Signature</code>: HMAC <code>v1</code> + Ed25519 <code>v1a</code>) and
          retried for 72 h. Verify them with <code>webhooks.constructEvent</code> from <code>@nearpay-money/node</code>.
        </p>
      ) : null}
      {secret ? <SecretOnce label="Signing secret" value={secret} onDone={() => setSecret(undefined)} /> : null}
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}
      <div data-testid="endpoints-table">
        <Table
          caption="Webhook endpoints"
          loading={list.loading && !list.data}
          rows={list.data?.data ?? []}
          rowKey={(e) => e.id}
          rowHref={(e) => app.href(`/developers/webhooks/${e.id}`)}
          empty={`No ${app.mode} endpoints yet.`}
          columns={[
            {
              key: "url",
              header: "Destination",
              primary: true,
              cell: (e) => <span className="dash-break">{e.url}</span>,
            },
            { key: "status", header: "Status", cell: (e) => <Badge kind="endpoint" value={e.status} /> },
            { key: "events", header: "Events", cell: eventsText, hideOnNarrow: true },
            { key: "created", header: "Created", cell: (e) => formatWhen(e.created), hideOnNarrow: true },
          ]}
        />
      </div>
      {open ? (
        <AddEndpoint
          onClose={() => setOpen(false)}
          onCreated={(s) => {
            setOpen(false);
            setSecret(s);
            list.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

export function WebhookDetail({ id }: { id: string }) {
  const app = useApp();
  const toast = useToast();
  const ep = useAsync(() => app.api.call(getWebhookEndpoint, { params: { id } }), [app.api, app.mode, id]);
  const [ping, setPing] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [rotating, setRotating] = useState(false);
  const [overlap, setOverlap] = useState(86_400);
  const deleting = useConfirm<true>();
  const test = useMutation(async () =>
    setPing((await app.api.call(testWebhookEndpoint, { params: { id }, body: {} })).id),
  );
  const toggle = useMutation(async (disabled: boolean) => {
    await app.api.call(updateWebhookEndpoint, { params: { id }, body: { disabled } });
    ep.reload();
  });
  const rotate = useMutation(async () => {
    const r = await app.api.call(rotateWebhookEndpointSecret, {
      params: { id },
      body: { expire_previous_in_seconds: overlap },
    });
    setRotating(false);
    setSecret(r.secret ?? undefined);
    ep.reload();
  });
  const del = useMutation(async () => {
    await app.api.call(deleteWebhookEndpoint, { params: { id } });
    toast.show({ tone: "success", title: "Endpoint deleted" });
    app.navigate(app.href("/developers/webhooks"));
  });

  if (ep.loading && !ep.data) return <LoadingState what="Loading endpoint" />;
  const e = ep.data;
  if (!e) return <ErrorState error={ep.error} onRetry={ep.reload} />;
  const disabled = e.status === "disabled";
  const actionError = test.error ?? toggle.error;
  return (
    <>
      <Section
        title={<span className="dash-break">{e.url}</span>}
        actions={
          <div className="dash-row-actions">
            <Button
              variant="secondary"
              size="sm"
              busy={test.busy}
              blocked={app.gate(testWebhookEndpoint)}
              onClick={() => void test.run()}
            >
              Send test event
            </Button>
            <Button
              variant="secondary"
              size="sm"
              blocked={app.gate(rotateWebhookEndpointSecret)}
              onClick={() => setRotating(true)}
            >
              Rotate secret
            </Button>
            <Button
              variant="secondary"
              size="sm"
              busy={toggle.busy}
              blocked={app.gate(updateWebhookEndpoint)}
              onClick={() => void toggle.run(!disabled)}
            >
              {disabled ? "Enable" : "Disable"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              blocked={app.gate(deleteWebhookEndpoint)}
              onClick={() => deleting.open(true)}
            >
              Delete
            </Button>
          </div>
        }
      >
        {secret ? <SecretOnce label="New signing secret" value={secret} onDone={() => setSecret(undefined)} /> : null}
        <KeyValue
          rows={[
            ["Endpoint ID", <Mono key="id">{e.id}</Mono>],
            ["Status", <Badge key="s" kind="endpoint" value={e.status} />],
            ...(e.disabled_reason ? ([["Disabled because", e.disabled_reason]] as [string, string][]) : []),
            ["API version", e.api_version],
            ["Events", e.enabled_events.includes("*") ? "All events" : e.enabled_events.join(", ")],
            ["Description", e.description ?? "—"],
            ["Created", formatTime(e.created)],
            ...(e.previous_secret_expires_at
              ? ([
                  [
                    "Previous secret",
                    `Still signs until ${formatTime(e.previous_secret_expires_at)} (${relative(e.previous_secret_expires_at)})`,
                  ],
                ] as [string, string][])
              : []),
          ]}
        />
        {ping ? (
          <Callout tone="success" title="Test event queued for delivery." live>
            <Mono>{ping}</Mono> · <Link to={`/developers/events/${ping}`}>View event</Link>
          </Callout>
        ) : null}
        <ErrorNote error={actionError} />
      </Section>
      <WebhookDeliveries endpointId={id} endpointEnabled={!disabled} />
      {rotating ? (
        <Modal
          title="Rotate signing secret"
          description="You get a new secret once. During the overlap, every delivery carries signatures with both secrets, so you can deploy the new one without dropping events."
          onClose={() => setRotating(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRotating(false)}>
                Cancel
              </Button>
              <Button busy={rotate.busy} onClick={() => void rotate.run()}>
                Rotate secret
              </Button>
            </>
          }
        >
          <Field label="The previous secret stops signing">
            {(fid) => (
              <Select id={fid} value={overlap} onChange={(ev) => setOverlap(Number(ev.target.value))}>
                {OVERLAP.map(([s, l]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ErrorNote error={rotate.error} />
        </Modal>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting.target)}
        title="Delete this endpoint?"
        description="Pending deliveries stop and no new events are sent to it."
        confirmLabel="Delete endpoint"
        busy={del.busy}
        error={del.error}
        onClose={deleting.close}
        onConfirm={() => void del.run()}
      />
    </>
  );
}

/**
 * Delivery log of one endpoint (`GET /v1/webhook_endpoints/{id}/deliveries`, spec 0.1.5): last 30 days,
 * newest first, cursor-paginated. Unknown statuses render as received. "Resend" queues the event again
 * for this endpoint (`POST /v1/events/{id}/resend`, spec 0.2.0).
 */
export function WebhookDeliveries({
  endpointId,
  endpointEnabled = true,
}: {
  endpointId: string;
  endpointEnabled?: boolean;
}) {
  const app = useApp();
  const toast = useToast();
  const page = useCursorList<WebhookDelivery>(
    (after) =>
      app.api.call(listWebhookEndpointDeliveries, {
        params: { id: endpointId },
        query: { limit: 20, ...(after ? { starting_after: after } : {}) },
      }),
    [app.api, app.mode, endpointId],
    20,
  );
  const resend = useMutation(async (d: WebhookDelivery) => {
    await app.api.call(resendEvent, { params: { id: d.event }, body: { endpoint: endpointId } });
    toast.show({
      tone: "success",
      title: "Event queued again",
      body: `${d.event_type} will be delivered to this endpoint.`,
    });
    page.reload();
  });
  const resendBlocked = !endpointEnabled ? "Enable the endpoint to resend events." : app.gate(resendEvent);
  const now = Math.floor(Date.now() / 1000);
  const rows = page.data?.data ?? [];
  return (
    <Section
      title="Deliveries"
      level={3}
      actions={
        <Button variant="secondary" size="sm" onClick={page.reload}>
          Refresh
        </Button>
      }
    >
      <p className="np-text-secondary">
        Every event sent to this endpoint in the last 30 days, newest first. Failed deliveries are retried with backoff
        for 72 h, then abandoned.
      </p>
      <ErrorNote error={page.error ?? resend.error} onRetry={page.error ? page.reload : undefined} />
      <div data-testid="deliveries-table">
        <Table
          caption="Deliveries"
          loading={page.loading && !page.data}
          rows={rows}
          rowKey={(d) => d.id}
          empty={page.hasPrevious ? "No more deliveries." : "No deliveries in the last 30 days."}
          columns={[
            {
              key: "event",
              header: "Event",
              primary: true,
              cell: (d) => (
                <span className="dash-cell-stack" data-testid={`delivery-${d.id}`}>
                  <Link to={`/developers/events/${d.event}`}>{d.event_type}</Link>
                  <Mono>{d.event}</Mono>
                  <span className="dash-narrow-only">
                    <Badge kind="delivery" value={d.status} />
                  </span>
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (d) => {
                const s = statusOf("delivery", d.status);
                return (
                  <span data-testid={`delivery-status-${d.id}`}>
                    <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  </span>
                );
              },
              hideOnNarrow: true,
            },
            { key: "attempts", header: "Attempts", numeric: true, cell: (d) => d.attempts, hideOnNarrow: true },
            {
              key: "last",
              header: "Last response",
              cell: (d) => (
                <span data-testid={`delivery-last-${d.id}`}>
                  {d.last_status_code !== null ? <Mono>HTTP {d.last_status_code}</Mono> : null}
                  {d.last_error ? <span className="np-text-secondary"> {d.last_error}</span> : null}
                  {d.last_status_code === null && !d.last_error ? "—" : null}
                </span>
              ),
              hideOnNarrow: true,
            },
            {
              key: "next",
              header: "Next attempt",
              cell: (d) => (
                <span data-testid={`delivery-next-${d.id}`}>
                  {d.next_attempt_at ? relative(d.next_attempt_at, now) : "—"}
                </span>
              ),
              hideOnNarrow: true,
            },
            { key: "created", header: "Created", cell: (d) => formatWhen(d.created), hideOnNarrow: true },
            {
              key: "actions",
              header: <span className="np-sr-only">Actions</span>,
              align: "end",
              cell: (d) => (
                <Button
                  variant="ghost"
                  size="sm"
                  blocked={resendBlocked}
                  busy={resend.busy}
                  onClick={() => void resend.run(d)}
                >
                  Resend
                </Button>
              ),
            },
          ]}
        />
      </div>
      {page.data ? (
        <Pager
          summary={rows.length ? `Showing ${page.offset}–${page.offset + rows.length - 1} deliveries` : undefined}
          hasMore={page.hasNext}
          canBack={page.hasPrevious}
          onNext={page.next}
          onBack={page.previous}
        />
      ) : null}
    </Section>
  );
}
