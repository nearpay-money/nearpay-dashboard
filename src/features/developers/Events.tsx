/**
 * Events (last 30 days) with a type filter, and the event page with its JSON and "Resend" (spec 0.2.0).
 * Stage 4: the 0.4.0 event union (`mandate.*` included).
 */
import { type Event, getEvent, listEvents, resendEvent, WEBHOOK_TYPE_NAMES } from "@nearpay/spec";
import { Callout, Select, Table } from "@nearpay-internal/ui";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatTime, formatWhen, shortId } from "../../lib/format";
import { useAsync, useCursorList, useMutation } from "../../lib/hooks";
import { ErrorState, LoadingState, Section } from "../../ui/page";
import { Button, ErrorNote, Field, KeyValue, Mono, Pager } from "../../ui/ui";

function objectRef(e: Event): string {
  const obj = e.data.object as { id?: unknown; object?: unknown };
  return typeof obj.id === "string" ? obj.id : String(obj.object ?? "");
}

export function Events() {
  const app = useApp();
  const [type, setType] = useState("");
  const page = useCursorList<Event>(
    (after) =>
      app.api.call(listEvents, {
        query: { limit: 25, ...(type ? { type } : {}), ...(after ? { starting_after: after } : {}) },
      }),
    [app.api, app.mode, type],
    25,
  );
  const rows = page.data?.data ?? [];
  return (
    <Section
      title="Events"
      aside="Last 30 days"
      actions={
        <div className="dash-inline-field">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {WEBHOOK_TYPE_NAMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      }
    >
      {page.error ? <ErrorNote error={page.error} onRetry={page.reload} /> : null}
      <div data-testid="events-table">
        <Table
          caption="Events"
          loading={page.loading && !page.data}
          rows={rows}
          rowKey={(e) => e.id}
          rowHref={(e) => app.href(`/developers/events/${e.id}`)}
          empty={`No ${type ? `${type} ` : ""}events in ${app.mode} mode.`}
          columns={[
            { key: "type", header: "Type", primary: true, cell: (e) => e.type },
            { key: "id", header: "Event", cell: (e) => <Mono>{shortId(e.id)}</Mono>, hideOnNarrow: true },
            { key: "obj", header: "Object", cell: (e) => <Mono>{objectRef(e)}</Mono>, hideOnNarrow: true },
            { key: "created", header: "Created", cell: (e) => formatWhen(e.created) },
          ]}
        />
      </div>
      {page.data ? (
        <Pager
          summary={rows.length ? `Showing ${page.offset}–${page.offset + rows.length - 1} events` : undefined}
          hasMore={page.hasNext}
          canBack={page.hasPrevious}
          onNext={page.next}
          onBack={page.previous}
        />
      ) : null}
    </Section>
  );
}

export function EventDetail({ id }: { id: string }) {
  const app = useApp();
  const evt = useAsync(() => app.api.call(getEvent, { params: { id } }), [app.api, app.mode, id]);
  const [queued, setQueued] = useState<number>();
  const resend = useMutation(async () => {
    const r = await app.api.call(resendEvent, { params: { id }, body: {} });
    setQueued(r.deliveries.length);
  });
  if (evt.loading && !evt.data) return <LoadingState what="Loading event" />;
  if (!evt.data) return <ErrorState error={evt.error} onRetry={evt.reload} />;
  const e = evt.data;
  return (
    <Section
      title={e.type}
      actions={
        e.type !== "ping" ? (
          <Button
            variant="secondary"
            size="sm"
            busy={resend.busy}
            blocked={app.gate(resendEvent)}
            onClick={() => void resend.run()}
          >
            Resend to endpoints
          </Button>
        ) : undefined
      }
    >
      <KeyValue
        rows={[
          ["Event ID", <Mono key="id">{e.id}</Mono>],
          ["Created", formatTime(e.created)],
          ["API version", e.api_version],
          ["Request", e.request.id ? <Mono key="r">{e.request.id}</Mono> : "—"],
          [
            "Object",
            objectRef(e).startsWith("md_") ? (
              <Link key="o" to={`/billing/mandates/${objectRef(e)}`}>
                <Mono>{objectRef(e)}</Mono>
              </Link>
            ) : (
              <Mono key="o">{objectRef(e)}</Mono>
            ),
          ],
        ]}
      />
      {queued !== undefined ? (
        <Callout
          tone="success"
          title={
            queued
              ? `Queued ${queued} new deliver${queued === 1 ? "y" : "ies"}.`
              : "No enabled endpoint subscribes to this event."
          }
          live
        >
          Receivers deduplicate on <code>NearPay-Event-Id</code>; the event keeps its id.{" "}
          <Link to="/developers/webhooks">View endpoints</Link>
        </Callout>
      ) : null}
      <ErrorNote error={resend.error} />
      <pre className="dash-json" data-testid="event-json">
        {JSON.stringify(e, null, 2)}
      </pre>
    </Section>
  );
}
