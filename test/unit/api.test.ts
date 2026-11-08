import {
  API_VERSION,
  createApiKey,
  createSettlementDestination,
  getDashboardSession,
  getInvoicePdf,
  getPaymentIntent,
  listCheckoutSessions,
  listWebhookEndpointDeliveries,
  logout,
  revokeApiKey,
} from "@nearpay/spec";
import { describe, expect, it, vi } from "vitest";
import { ApiClient, encodeQuery, filenameOf } from "../../src/lib/api";
import { ApiError, describeError, StepUpCanceled } from "../../src/lib/errors";
import { apiKey, delivery, destination, endpoint, intent } from "../e2e/fixtures";

const PI = intent();
const KEY = { ...apiKey(), secret: `sk_test_${"A1b2C3d4".repeat(6)}` };
const SD = destination();
const LIST = { object: "list", data: [], has_more: false, url: "/v1/checkout/sessions" };

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: Response[]) {
  const seen: Seen[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const r = responses.shift();
    if (!r) throw new Error("no response queued");
    return r;
  });
  return { f: f as unknown as typeof fetch, seen };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const envelope = (status: number, type: string, code: string) =>
  json(status, { error: { type, code, message: `m:${code}`, doc_url: "https://d", request_id: "req_1" } });

const h = (s: Seen) => s.init.headers as Record<string, string>;

function client(f: typeof fetch, extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) {
  let n = 0;
  return new ApiClient({
    base: "/api",
    fetch: f,
    mode: () => "test",
    csrf: () => "csrf-abc",
    uuid: () => `uuid-${++n}`,
    ...extra,
  });
}

describe("ApiClient", () => {
  it("GETs same-origin with mode and version, no CSRF, no body", async () => {
    const { f, seen } = fakeFetch([json(200, PI)]);
    const r = await client(f, { mode: () => "live" }).call(getPaymentIntent, { params: { id: "pi_1" } });
    expect(r).toEqual(PI);
    expect(seen[0]?.url).toBe("/api/v1/payment_intents/pi_1");
    expect(seen[0]?.init.method).toBe("GET");
    expect(seen[0]?.init.credentials).toBe("same-origin");
    expect(h(seen[0] as Seen)["NearPay-Mode"]).toBe("live");
    expect(h(seen[0] as Seen)["NearPay-Version"]).toBe(API_VERSION);
    expect(h(seen[0] as Seen)["X-CSRF-Token"]).toBeUndefined();
    expect(seen[0]?.init.body).toBeUndefined();
  });

  it("encodes list queries", async () => {
    const { f, seen } = fakeFetch([json(200, LIST)]);
    await client(f).call(listCheckoutSessions, { query: { limit: 5, expand: ["payment_intent"], status: "" } });
    expect(seen[0]?.url).toBe("/api/v1/checkout/sessions?limit=5&expand%5B%5D=payment_intent");
  });

  it("sends CSRF, JSON body and an Idempotency-Key on idempotent writes", async () => {
    const { f, seen } = fakeFetch([json(201, KEY)]);
    await client(f).call(createApiKey, { body: { type: "secret", livemode: false, name: "server" } });
    const hd = h(seen[0] as Seen);
    expect(hd["X-CSRF-Token"]).toBe("csrf-abc");
    expect(hd["Idempotency-Key"]).toBe("uuid-1");
    expect(hd["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({ type: "secret", livemode: false, name: "server" });
  });

  it("sends no Idempotency-Key on non-idempotent POSTs, no body on DELETE; 204 → undefined", async () => {
    const { f, seen } = fakeFetch([new Response(null, { status: 204 }), new Response(null, { status: 204 })]);
    const c = client(f);
    expect(await c.call(logout, { body: {} })).toBeUndefined();
    expect(h(seen[0] as Seen)["Idempotency-Key"]).toBeUndefined();
    expect(seen[0]?.init.body).toBe("{}");
    await c.call(revokeApiKey, { params: { id: "key_1" } });
    expect(seen[1]?.init.method).toBe("DELETE");
    expect(seen[1]?.init.body).toBeUndefined();
    expect(h(seen[1] as Seen)["X-CSRF-Token"]).toBe("csrf-abc");
  });

  it("omits CSRF when there is none and tolerates empty 200 bodies", async () => {
    const { f, seen } = fakeFetch([new Response("", { status: 200 })]);
    expect(await client(f, { csrf: () => undefined }).call(logout, { body: {} })).toBeUndefined();
    expect(h(seen[0] as Seen)["X-CSRF-Token"]).toBeUndefined();
  });

  it("on step_up_required opens step-up and replays once with the same Idempotency-Key", async () => {
    const { f, seen } = fakeFetch([envelope(401, "authentication_error", "step_up_required"), json(201, SD)]);
    const stepUp = vi.fn(async () => {});
    const body = {
      asset_id: "nep141:usdc.near",
      type: "intents_account",
      chain: "near:mainnet",
      address: "m.near",
      label: "x",
    } as const;
    const r = await client(f, { stepUp }).call(createSettlementDestination, { body });
    expect(r).toEqual(SD);
    expect(stepUp).toHaveBeenCalledOnce();
    expect(h(seen[0] as Seen)["Idempotency-Key"]).toBe(h(seen[1] as Seen)["Idempotency-Key"]);
  });

  it("propagates a canceled step-up and does not loop on a second step_up_required", async () => {
    const { f } = fakeFetch([envelope(401, "authentication_error", "step_up_required")]);
    const c = client(f, { stepUp: () => Promise.reject(new StepUpCanceled()) });
    await expect(c.call(createApiKey, { body: { type: "secret", livemode: false, name: "n" } })).rejects.toBeInstanceOf(
      StepUpCanceled,
    );
    const two = fakeFetch([
      envelope(401, "authentication_error", "step_up_required"),
      envelope(401, "authentication_error", "step_up_required"),
    ]);
    const e = await client(two.f, { stepUp: async () => {} })
      .call(createApiKey, { body: { type: "secret", livemode: false, name: "n" } })
      .catch((x: unknown) => x);
    expect((e as ApiError).code).toBe("step_up_required");
    const none = fakeFetch([envelope(401, "authentication_error", "step_up_required")]);
    await expect(
      client(none.f).call(createApiKey, { body: { type: "secret", livemode: false, name: "n" } }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("signals a lost session on authentication_required and csrf_token_invalid only", async () => {
    const unauthenticated = vi.fn();
    const { f } = fakeFetch([
      envelope(401, "authentication_error", "authentication_required"),
      envelope(403, "permission_error", "csrf_token_invalid"),
      envelope(403, "permission_error", "permission_denied"),
    ]);
    const c = client(f, { unauthenticated });
    for (let i = 0; i < 3; i++) await c.call(getPaymentIntent, { params: { id: "pi_1" } }).catch(() => {});
    expect(unauthenticated).toHaveBeenCalledTimes(2);
  });

  it("uses crypto.randomUUID by default", async () => {
    const { f, seen } = fakeFetch([json(201, KEY)]);
    await new ApiClient({ base: "", fetch: f, mode: () => "test", csrf: () => undefined }).call(createApiKey, {
      body: { type: "secret", livemode: false, name: "n" },
    });
    expect(h(seen[0] as Seen)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("parses responses tolerantly: unknown open-enum values pass, contract breaks are invalid_response", async () => {
    const we = endpoint();
    const odd = { ...delivery(we.id), status: "quarantined", extra_field: 1 };
    const page = { object: "list", data: [odd], has_more: true, url: `/v1/webhook_endpoints/${we.id}/deliveries` };
    const { f } = fakeFetch([
      json(200, page),
      json(200, { ...PI, status: "teleported" }),
      json(200, { ...PI, amount: "lots" }, { "x-request-id": "req_bad" }),
      new Response("<html>", { status: 200 }),
      json(200, { ...KEY, object: "api_token" }),
    ]);
    const c = client(f);
    const r = await c.call(listWebhookEndpointDeliveries, { params: { id: we.id } });
    expect(r.data[0]?.status as string).toBe("quarantined");
    expect(r.data[0]).toMatchObject({ extra_field: 1 });
    expect((await c.call(getPaymentIntent, { params: { id: PI.id } })).status as string).toBe("teleported");
    const bad = await c.call(getPaymentIntent, { params: { id: PI.id } }).catch((x: unknown) => x);
    expect(bad).toMatchObject({ code: "invalid_response", status: 200, requestId: "req_bad" });
    await expect(c.call(getPaymentIntent, { params: { id: PI.id } })).rejects.toMatchObject({
      code: "invalid_response",
    });
    // literals (and closed enums) stay strict: a wrong `object` is a contract break, not tolerated
    await expect(c.call(createApiKey, { body: { type: "secret", livemode: false, name: "n" } })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("reads the current session (GET /v1/auth/session) with the session cookie and no CSRF", async () => {
    const s = {
      object: "dashboard_session",
      user: { id: "usr_01jbz9k3m4n5p6q7r8s9t0v1w2", email: "a@b.co" },
      account: { id: "acct_01jbz9k3m4n5p6q7r8s9t0v1w2", display_name: "Acme" },
      role: "owner",
      csrf_token: "c".repeat(43),
      expires_at: 2_000_000_000,
    };
    const { f, seen } = fakeFetch([json(200, s)]);
    expect(await client(f).call(getDashboardSession)).toEqual(s);
    expect(seen[0]?.url).toBe("/api/v1/auth/session");
    expect(seen[0]?.init.credentials).toBe("same-origin");
    expect(h(seen[0] as Seen)["X-CSRF-Token"]).toBeUndefined();
  });

  it("encodeQuery", () => {
    expect(encodeQuery(undefined)).toBe("");
    expect(encodeQuery({ a: null, b: undefined, c: "" })).toBe("");
    expect(encodeQuery({ "created[gte]": 5 })).toBe("?created%5Bgte%5D=5");
  });
});

describe("ApiError", () => {
  it("parses envelopes and falls back on non-envelopes", async () => {
    const e = await ApiError.fromResponse(
      json(400, {
        error: {
          type: "invalid_request_error",
          code: "address_invalid",
          message: "bad",
          param: "address",
          request_id: "req_x",
        },
      }),
    );
    expect(e).toMatchObject({ status: 400, code: "address_invalid", param: "address", requestId: "req_x" });
    const f5 = await ApiError.fromResponse(
      new Response("<html>", { status: 502, headers: { "x-request-id": "req_h" } }),
    );
    expect(f5).toMatchObject({ code: "api_error", type: "api_error", requestId: "req_h" });
    const f4 = await ApiError.fromResponse(new Response("nope", { status: 404 }));
    expect(f4).toMatchObject({ code: "http_error", type: "invalid_request_error", requestId: undefined });
    const partial = await ApiError.fromResponse(json(409, { error: { code: "x", message: "y" } }));
    expect(partial.type).toBe("api_error");
  });

  it("describeError", () => {
    expect(describeError(new ApiError({ status: 400, type: "t", code: "c", message: "m", requestId: "req_1" }))).toBe(
      "m (c, req_1)",
    );
    expect(describeError(new ApiError({ status: 400, type: "t", code: "c", message: "m" }))).toBe("m (c)");
    expect(describeError(new Error("plain"))).toBe("plain");
    expect(describeError("str")).toBe("str");
    expect(new StepUpCanceled().message).toMatch(/canceled/);
  });
});

describe("ApiClient.download (binary routes)", () => {
  it("fetches the PDF with mode header and returns blob + file name", async () => {
    const pdf = new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="ACME-T-00012.pdf"' },
    });
    const { f, seen } = fakeFetch([pdf]);
    const r = await client(f, { mode: () => "live" }).download(getInvoicePdf, { params: { id: "in_1" } });
    expect(seen[0]?.url).toBe("/api/v1/invoices/in_1/pdf");
    expect(h(seen[0] as Seen).Accept).toBe("application/pdf");
    expect(h(seen[0] as Seen)["NearPay-Mode"]).toBe("live");
    expect(r.filename).toBe("ACME-T-00012.pdf");
    expect(new Uint8Array(await r.blob.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });
  it("maps errors (draft → 409) and refuses a non-PDF body", async () => {
    const { f } = fakeFetch([envelope(409, "invalid_request_error", "state_conflict"), json(200, { not: "a pdf" })]);
    const c = client(f);
    await expect(c.download(getInvoicePdf, { params: { id: "in_1" } })).rejects.toMatchObject({
      code: "state_conflict",
    });
    await expect(c.download(getInvoicePdf, { params: { id: "in_1" } })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("readHeaders carries mode and API version", () => {
    const { f } = fakeFetch([]);
    expect(client(f, { mode: () => "test" }).readHeaders()).toEqual({
      "NearPay-Mode": "test",
      "NearPay-Version": API_VERSION,
    });
  });
  it("filenameOf strips paths, quotes and control characters", () => {
    expect(filenameOf(null)).toBeUndefined();
    expect(filenameOf("attachment")).toBeUndefined();
    expect(filenameOf('attachment; filename="../../etc/x.pdf"')).toBe("....etcx.pdf");
    expect(filenameOf("attachment; filename*=UTF-8''INV%2001.pdf")).toBe("INV 01.pdf");
    expect(filenameOf("attachment; filename=%E0%A4%A.pdf")).toBe("%E0%A4%A.pdf");
    expect(filenameOf('attachment; filename="a\u0001b.pdf"')).toBe("ab.pdf");
    expect(filenameOf('attachment; filename=" "')).toBeUndefined();
  });
});
