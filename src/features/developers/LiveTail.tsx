/**
 * Developers → Live tail (lld/webhooks.md §5.1; spec 0.3.0 `streamEvents`): events of the current mode
 * as they happen. The stream is read with `fetch` (so `NearPay-Mode` follows the Test/Live switch; a
 * mode change remounts the page and opens a new stream) and resumes like `EventSource`: reconnects and
 * "Resume" send `Last-Event-ID`, so the server replays what was missed. Delivery is at-least-once, so
 * rows are deduplicated by event id. Pause closes the stream (the server keeps the events); Clear
 * empties the list only. Streamed events are not webhook deliveries (not signed, not retried).
 */
import {
  buildPath,
  type Event,
  Event as EventSchema,
  EventStreamReady,
  EventStreamReset,
  safeParseTolerant,
  streamEvents,
  WEBHOOK_TYPE_NAMES,
} from "@nearpay/spec";
import { Button, Callout, LiveRegion, Select, StatusBadge } from "@nearpay-internal/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useApp } from "../../app/context";
import { encodeQuery } from "../../lib/api";
import { API_BASE } from "../../lib/config";
import { ApiError } from "../../lib/errors";
import { formatClock } from "../../lib/format";
import { EventStream, type StreamState } from "../../lib/sse";
import { Section } from "../../ui/page";
import { ErrorNote, Field } from "../../ui/ui";
import "../billing/billing.css";

/** Rows kept on screen (oldest dropped first). */
export const TAIL_MAX = 200;

function objectRef(e: Event): string {
  const obj = e.data.object as { id?: unknown; object?: unknown };
  return typeof obj.id === "string" ? obj.id : String(obj.object ?? "");
}

const stateLabel = (
  s: StreamState,
  paused: boolean,
): { label: string; tone: "success" | "warning" | "neutral" | "danger" } => {
  if (paused) return { label: "Paused", tone: "neutral" };
  switch (s.kind) {
    case "open":
      return { label: "Live", tone: "success" };
    case "connecting":
      return { label: s.attempt > 1 ? "Reconnecting" : "Connecting", tone: "warning" };
    case "waiting":
      return { label: s.reason === "rate_limited" ? "Too many streams" : "Reconnecting", tone: "warning" };
    case "failed":
      return { label: "Stopped", tone: "danger" };
    default:
      return { label: "Paused", tone: "neutral" };
  }
};

export function LiveTail() {
  const app = useApp();
  const [type, setType] = useState("");
  const [rows, setRows] = useState<Event[]>([]);
  const [state, setState] = useState<StreamState>({ kind: "connecting", attempt: 1 });
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [ready, setReady] = useState<{ resumed: boolean } | undefined>();
  const seen = useRef(new Set<string>());
  const streamRef = useRef<EventStream | undefined>(undefined);

  const url = useMemo(
    () => `${API_BASE}${buildPath(streamEvents, {})}${encodeQuery(type ? { types: type } : undefined)}`,
    [type],
  );

  // one stream per URL (filter); a mode change remounts the page and opens a new stream
  useEffect(() => {
    // a new filter continues from the last event seen (no gap, no duplicates)
    const resumeFrom = streamRef.current?.lastEventId;
    const s = new EventStream({
      url,
      headers: () => app.api.readHeaders(),
      onState: setState,
      onFrame: (f) => {
        let json: unknown;
        try {
          json = JSON.parse(f.data);
        } catch {
          return;
        }
        if (f.event === "event") {
          const r = safeParseTolerant(EventSchema, json);
          if (!r.success) return;
          const e = r.data as Event;
          if (seen.current.has(e.id)) return;
          seen.current.add(e.id);
          setRows((xs) => [e, ...xs].slice(0, TAIL_MAX));
        } else if (f.event === "ready") {
          const r = safeParseTolerant(EventStreamReady, json);
          if (r.success) setReady({ resumed: r.data.resumed_after !== null });
        } else if (f.event === "reset") {
          const r = safeParseTolerant(EventStreamReset, json);
          if (r.success)
            setNotice(
              r.data.reason === "cursor_expired"
                ? "Events from before the pause are older than 30 days, so the tail continues with new events only."
                : "The tail couldn't catch up from where it paused and continues with new events only. See Events for the full list.",
            );
        }
      },
    });
    streamRef.current = s;
    s.start(resumeFrom);
    setPaused(false);
    return () => s.stop();
  }, [url, app.api]);

  const pause = () => {
    streamRef.current?.stop();
    setPaused(true);
  };
  const resume = () => {
    setPaused(false);
    streamRef.current?.start();
  };
  const st = stateLabel(state, paused);
  const failed = state.kind === "failed" ? state : undefined;
  const failure = failed
    ? new ApiError({
        status: failed.status,
        type: "api_error",
        code:
          ((failed.body as { error?: { code?: string } } | undefined)?.error?.code as string | undefined) ??
          (failed.status === 401 ? "authentication_required" : "http_error"),
        message:
          ((failed.body as { error?: { message?: string } } | undefined)?.error?.message as string | undefined) ??
          `The event stream answered ${failed.status}.`,
      })
    : undefined;

  return (
    <Section
      title="Live tail"
      aside={`${app.mode === "live" ? "Live" : "Test"} mode`}
      actions={
        <div className="npf-tail__bar">
          <div className="dash-inline-field">
            <Field label="Type">
              {(id) => (
                <Select id={id} value={type} onChange={(e) => setType(e.target.value)} data-testid="tail-type">
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
          {paused || failed ? (
            <Button variant="secondary" size="sm" onClick={resume} data-testid="tail-resume">
              {failed ? "Retry" : "Resume"}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={pause} data-testid="tail-pause">
              Pause
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRows([])}
            disabled={rows.length === 0}
            data-testid="tail-clear"
          >
            Clear
          </Button>
        </div>
      }
    >
      <LiveRegion>{`Live tail ${st.label.toLowerCase()}.`}</LiveRegion>
      <p className="npf-tail__state np-text-small np-text-secondary">
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        <span data-testid="tail-state">
          {paused
            ? "Paused. Events keep arriving on the server; Resume catches up from where you paused."
            : state.kind === "waiting"
              ? `Connection closed. Reconnecting in ${Math.ceil(state.retryInMs / 1000)} s and catching up.`
              : state.kind === "open"
                ? `Showing ${app.mode} events as they happen${ready?.resumed ? " (caught up after reconnecting)" : ""}.`
                : state.kind === "failed"
                  ? "The stream stopped."
                  : "Connecting…"}
        </span>
      </p>
      {failure ? <ErrorNote error={failure} /> : null}
      {notice ? (
        <Callout tone="warning" title="Some events were skipped">
          {notice}
        </Callout>
      ) : null}
      {rows.length === 0 ? (
        <p className="np-text-secondary" data-testid="tail-empty">
          Waiting for {type || "events"} in {app.mode} mode. Trigger one with the CLI ({"nearpay trigger"}) or a test
          payment.
        </p>
      ) : (
        <ul className="npf-tail__list" aria-label="Live events" data-testid="tail-list">
          {rows.map((e) => (
            <li key={e.id} className="npf-tail__row">
              <time className="npf-tail__time" dateTime={new Date(e.created * 1000).toISOString()}>
                {formatClock(e.created)}
              </time>
              <span className="npf-tail__type">{e.type}</span>
              <code className="npf-billing__mono">{objectRef(e)}</code>
              <Link to={`/developers/events/${e.id}`} aria-label={`Open event ${e.type} ${e.id}`}>
                View
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="np-text-caption np-text-secondary">
        Streamed events are for watching only: they aren't webhook deliveries, aren't signed and aren't retried. Up to{" "}
        {TAIL_MAX} recent events are kept on this page.
      </p>
    </Section>
  );
}
