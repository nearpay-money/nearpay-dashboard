import {
  API_VERSION,
  createApiKey,
  createSettlementDestination,
  getPaymentIntent,
  listCheckoutSessions,
  logout,
  revokeApiKey,
} from "@nearpay/spec";
import { describe, expect, it, vi } from "vitest";
import { ApiClient, encodeQuery } from "../../src/lib/api";
import { ApiError, describeError, StepUpCanceled } from "../../src/lib/errors";

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
    const { f, seen } = fakeFetch([json(200, { id: "pi_1" })]);
    const r = await client(f, { mode: () => "live" }).call(getPaymentIntent, { params: { id: "pi_1" } });
    expect(r).toEqual({ id: "pi_1" });
    expect(seen[0]?.url).toBe("/api/v1/payment_intents/pi_1");
    expect(seen[0]?.init.method).toBe("GET");
    expect(seen[0]?.init.credentials).toBe("same-origin");
    expect(h(seen[0] as Seen)["NearPay-Mode"]).toBe("live");
    expect(h(seen[0] as Seen)["NearPay-Version"]).toBe(API_VERSION);
    expect(h(seen[0] as Seen)["X-CSRF-Token"]).toBeUndefined();
    expect(seen[0]?.init.body).toBeUndefined();
  });

  it("encodes list queries", async () => {
    const { f, seen } = fakeFetch([json(200, { data: [] })]);
    await client(f).call(listCheckoutSessions, { query: { limit: 5, expand: ["payment_intent"], status: "" } });
    expect(seen[0]?.url).toBe("/api/v1/checkout/sessions?limit=5&expand%5B%5D=payment_intent");
  });

  it("sends CSRF, JSON body and an Idempotency-Key on idempotent writes", async () => {
    const { f, seen } = fakeFetch([json(201, { id: "key_1" })]);
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
    const { f, seen } = fakeFetch([
      envelope(401, "authentication_error", "step_up_required"),
      json(201, { id: "sd_1" }),
    ]);
    const stepUp = vi.fn(async () => {});
    const body = {
      asset_id: "nep141:usdc.near",
      type: "intents_account",
      chain: "near:mainnet",
      address: "m.near",
      label: "x",
    } as const;
    const r = await client(f, { stepUp }).call(createSettlementDestination, { body });
    expect(r).toEqual({ id: "sd_1" });
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
    const { f, seen } = fakeFetch([json(201, {})]);
    await new ApiClient({ base: "", fetch: f, mode: () => "test", csrf: () => undefined }).call(createApiKey, {
      body: { type: "secret", livemode: false, name: "n" },
    });
    expect(h(seen[0] as Seen)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
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
