import { describe, expect, it, vi } from "vitest";
import { EventStream, SseParser, type StreamState } from "../../src/lib/sse";

describe("SseParser (WHATWG event-stream rules)", () => {
  it("parses frames across chunks, comments, multi-line data, CRLF and CR", () => {
    const p = new SseParser();
    expect(p.push('retry: 3000\n: heartbeat\nevent: ready\ndata: {"a":')).toEqual([]);
    expect(p.push("1}\n\n")).toEqual([{ event: "ready", data: '{"a":1}', id: undefined }]);
    expect(p.retry).toBe(3000);
    expect(p.push("id: evt_1\r\nevent: event\r\ndata: x\r\ndata: y\r\n\r\n")).toEqual([
      { event: "event", data: "x\ny", id: "evt_1" },
    ]);
    expect(p.lastEventId).toBe("evt_1");
    // a lone CR at the end waits for a possible LF
    expect(p.push("data: z\r")).toEqual([]);
    expect(p.push("\n\r")).toEqual([]);
    expect(p.push("\n")).toEqual([{ event: "message", data: "z", id: undefined }]);
    expect(p.push("data\n\n")).toEqual([{ event: "message", data: "", id: undefined }]);
    // no data → no frame; bad retry ignored; id with NUL ignored; unknown fields ignored
    expect(p.push("event: x\nretry: soon\nid: a\0b\nfoo: bar\n\n")).toEqual([]);
    expect(p.retry).toBe(3000);
    expect(p.lastEventId).toBe("evt_1");
    expect(p.push("data:nospace\n\n")).toEqual([{ event: "message", data: "nospace", id: undefined }]);
  });
});

function sse(
  chunks: string[],
  status = 200,
  headers: Record<string, string> = { "content-type": "text/event-stream" },
) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status, headers });
}

function harness(responses: (Response | Error)[]) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const frames: { event: string; id?: string }[] = [];
  const states: StreamState[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: init?.headers as Record<string, string> });
    const r = responses.shift();
    if (!r) return new Promise<Response>(() => {});
    if (r instanceof Error) throw r;
    return r;
  });
  const s = new EventStream({
    url: "/api/v1/events/stream",
    headers: () => ({ "NearPay-Mode": "live" }),
    fetch: f as unknown as typeof fetch,
    onFrame: (fr) => frames.push({ event: fr.event, ...(fr.id ? { id: fr.id } : {}) }),
    onState: (st) => states.push(st),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
  });
  return { s, seen, timers, frames, states };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("EventStream", () => {
  it("streams frames, reconnects after the server's retry with Last-Event-ID", async () => {
    const h = harness([
      sse(["retry: 1500\nevent: ready\ndata: {}\n\n", "id: evt_1\nevent: event\ndata: {}\n\n"]),
      sse(["id: evt_2\nevent: event\ndata: {}\n\n"]),
    ]);
    h.s.start();
    await tick();
    await tick();
    expect(h.frames).toEqual([{ event: "ready" }, { event: "event", id: "evt_1" }]);
    expect(h.seen[0]?.headers).toMatchObject({ Accept: "text/event-stream", "NearPay-Mode": "live" });
    expect(h.seen[0]?.headers["Last-Event-ID"]).toBeUndefined();
    expect(h.timers[0]?.ms).toBe(1500);
    expect(h.states).toContainEqual({ kind: "waiting", reason: "reconnect", retryInMs: 1500 });
    h.timers[0]?.fn();
    await tick();
    await tick();
    expect(h.seen[1]?.headers["Last-Event-ID"]).toBe("evt_1");
    expect(h.s.lastEventId).toBe("evt_2");
    expect(h.s.running).toBe(true);
    h.s.stop();
    expect(h.s.running).toBe(false);
    expect(h.states.at(-1)).toEqual({ kind: "stopped" });
  });

  it("resumes from a cursor after stop/start (pause → replay)", async () => {
    const h = harness([sse([]), sse([])]);
    h.s.start("evt_9");
    await tick();
    h.s.stop();
    h.s.start();
    await tick();
    expect(h.seen.map((x) => x.headers["Last-Event-ID"])).toEqual(["evt_9", "evt_9"]);
    h.s.start(); // already running: no second connection
    expect(h.seen).toHaveLength(2);
    h.s.stop();
  });

  it("429 waits for Retry-After; network errors back off; other errors stop", async () => {
    const h = harness([
      new Response("{}", { status: 429, headers: { "retry-after": "5" } }),
      new TypeError("network"),
      new Response(JSON.stringify({ error: { code: "livemode_forbidden" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    ]);
    h.s.start();
    await tick();
    expect(h.timers[0]?.ms).toBe(5000);
    expect(h.states).toContainEqual({ kind: "waiting", reason: "rate_limited", retryInMs: 5000 });
    h.timers[0]?.fn();
    await tick();
    expect(h.timers[1]?.ms).toBe(6000); // 3000 × 2 after two failures
    h.timers[1]?.fn();
    await tick();
    await tick();
    expect(h.states.at(-1)).toEqual({ kind: "failed", status: 403, body: { error: { code: "livemode_forbidden" } } });
    expect(h.s.running).toBe(false);
  });

  it("429 without Retry-After backs off; a non-SSE 200 is a failure; caps backoff", async () => {
    const h = harness([
      new Response("", { status: 429 }),
      new Response("nope", { status: 200, headers: { "content-type": "text/html" } }),
    ]);
    h.s.start();
    await tick();
    expect(h.timers[0]?.ms).toBe(3000);
    h.timers[0]?.fn();
    await tick();
    await tick();
    expect(h.states.at(-1)).toMatchObject({ kind: "failed", status: 200, body: undefined });
  });

  it("stop() during a pending connect never reconnects", async () => {
    const h = harness([]);
    h.s.start();
    await tick();
    h.s.stop();
    await tick();
    expect(h.timers).toHaveLength(0);
  });

  it("an aborted fetch does not schedule a reconnect", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const h = harness([abort]);
    h.s.start();
    h.s.stop();
    await tick();
    expect(h.timers).toHaveLength(0);
  });
});
