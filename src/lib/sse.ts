/**
 * Server-sent events over `fetch` for the developers live tail (`GET /v1/events/stream`, spec 0.3.0
 * `streamEvents`; lld/webhooks.md §5.1). `EventSource` cannot send headers, but a dashboard session
 * streams the mode named by `NearPay-Mode` (INV-8), so the stream is read with `fetch` and parsed here
 * with the WHATWG event-stream rules. Reconnects behave like `EventSource`: after the server's `retry`
 * (3 s) the stream reopens with `Last-Event-ID` = the last `id:` seen, so the server replays what was
 * missed; `429` waits for `Retry-After`; other HTTP errors stop the stream (as `EventSource` gives up).
 */

export interface SseFrame {
  readonly event: string;
  readonly data: string;
  readonly id: string | undefined;
}

/** Incremental `text/event-stream` parser (CR, LF and CRLF line ends; comments; multi-line data). */
export class SseParser {
  #buf = "";
  #data: string[] = [];
  #event = "";
  #id: string | undefined;
  /** Last `id:` field seen (persists across frames, like `EventSource.lastEventId`). */
  lastEventId: string | undefined;
  /** Last valid `retry:` value in ms. */
  retry: number | undefined;

  push(chunk: string): SseFrame[] {
    this.#buf += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const m = /\r\n|\r|\n/.exec(this.#buf);
      if (!m) break;
      // a lone CR at the end of the buffer may be the first half of CRLF: wait for more input
      if (m[0] === "\r" && m.index === this.#buf.length - 1) break;
      const line = this.#buf.slice(0, m.index);
      this.#buf = this.#buf.slice(m.index + m[0].length);
      const f = this.#line(line);
      if (f) frames.push(f);
    }
    return frames;
  }

  #line(line: string): SseFrame | undefined {
    if (line === "") {
      const hadData = this.#data.length > 0;
      const frame = { event: this.#event || "message", data: this.#data.join("\n"), id: this.#id };
      this.#data = [];
      this.#event = "";
      this.#id = undefined;
      return hadData ? frame : undefined;
    }
    if (line.startsWith(":")) return undefined;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    let value = i === -1 ? "" : line.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.#data.push(value);
    else if (field === "event") this.#event = value;
    else if (field === "id" && !value.includes("\0")) {
      this.#id = value;
      this.lastEventId = value;
    } else if (field === "retry" && /^\d+$/.test(value)) this.retry = Number(value);
    return undefined;
  }
}

export type StreamState =
  | { kind: "connecting"; attempt: number }
  | { kind: "open" }
  | { kind: "waiting"; reason: "reconnect" | "rate_limited"; retryInMs: number }
  | { kind: "stopped" }
  | { kind: "failed"; status: number; body: unknown };

export interface EventStreamOptions {
  /** Full URL (query string included). */
  readonly url: string;
  /** Request headers (mode, API version); read at each (re)connect. */
  readonly headers: () => Record<string, string>;
  readonly onFrame: (f: SseFrame) => void;
  readonly onState: (s: StreamState) => void;
  readonly fetch?: typeof fetch;
  /** Reconnect delay before the server sends `retry:` (spec `EVENT_STREAM_RETRY_MS`). */
  readonly retryMs?: number;
  /** Upper bound of the backoff after consecutive failed connects. */
  readonly maxRetryMs?: number;
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (t: unknown) => void;
}

/**
 * One logical stream: `start(lastEventId?)` connects and keeps reconnecting until `stop()`. The resume
 * cursor survives `stop()`/`start()`, so pausing and resuming replays the events in between.
 */
export class EventStream {
  readonly #o: EventStreamOptions;
  #ctrl: AbortController | undefined;
  #timer: unknown;
  #running = false;
  #failures = 0;
  #retry: number;
  #lastId: string | undefined;

  constructor(o: EventStreamOptions) {
    this.#o = o;
    this.#retry = o.retryMs ?? 3000;
  }

  get lastEventId(): string | undefined {
    return this.#lastId;
  }

  get running(): boolean {
    return this.#running;
  }

  start(lastEventId?: string): void {
    if (this.#running) return;
    if (lastEventId !== undefined) this.#lastId = lastEventId;
    this.#running = true;
    this.#failures = 0;
    void this.#connect();
  }

  stop(): void {
    this.#running = false;
    this.#ctrl?.abort();
    this.#ctrl = undefined;
    if (this.#timer !== undefined) (this.#o.clearTimeout ?? clearTimeout)(this.#timer as never);
    this.#timer = undefined;
    this.#o.onState({ kind: "stopped" });
  }

  #schedule(reason: "reconnect" | "rate_limited", ms: number): void {
    if (!this.#running) return;
    this.#o.onState({ kind: "waiting", reason, retryInMs: ms });
    this.#timer = (this.#o.setTimeout ?? setTimeout)(() => {
      this.#timer = undefined;
      void this.#connect();
    }, ms);
  }

  async #connect(): Promise<void> {
    if (!this.#running) return;
    const ctrl = new AbortController();
    this.#ctrl = ctrl;
    this.#o.onState({ kind: "connecting", attempt: this.#failures + 1 });
    const headers: Record<string, string> = { Accept: "text/event-stream", ...this.#o.headers() };
    if (this.#lastId) headers["Last-Event-ID"] = this.#lastId;
    let res: Response;
    try {
      res = await (this.#o.fetch ?? fetch)(this.#o.url, {
        method: "GET",
        headers,
        credentials: "same-origin",
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch {
      if (ctrl.signal.aborted) return;
      this.#failures++;
      this.#schedule("reconnect", this.#backoff());
      return;
    }
    if (res.status === 429) {
      const after = Number(res.headers.get("retry-after"));
      void res.body?.cancel();
      this.#failures++;
      this.#schedule("rate_limited", Number.isFinite(after) && after > 0 ? after * 1000 : this.#backoff());
      return;
    }
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("text/event-stream") || !res.body) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      this.#running = false;
      this.#o.onState({ kind: "failed", status: res.status, body });
      return;
    }
    this.#failures = 0;
    this.#o.onState({ kind: "open" });
    const parser = new SseParser();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const f of parser.push(decoder.decode(value, { stream: true }))) {
          if (f.id !== undefined) this.#lastId = f.id;
          this.#o.onFrame(f);
        }
        if (parser.retry !== undefined) this.#retry = parser.retry;
      }
    } catch {
      // network drop or abort: handled below
    }
    if (ctrl.signal.aborted || !this.#running) return;
    // the server closed the stream (1 h limit, deploy, slow reader): reopen with Last-Event-ID
    this.#schedule("reconnect", this.#retry);
  }

  #backoff(): number {
    const max = this.#o.maxRetryMs ?? 30_000;
    return Math.min(max, this.#retry * 2 ** Math.max(0, this.#failures - 1));
  }
}
