/**
 * Spec-driven mock of the gateway + services for the dashboard E2E tests (Playwright route
 * interception of `/api/**`). Each request is matched to a `@nearpay/spec` public route and checked like
 * the real stack would: `NearPay-Mode` header, session cookie (an in-memory flag), CSRF header on unsafe
 * methods, Idempotency-Key on idempotent writes, roles, step-up freshness, strict body/query validation
 * against the route schemas. Every mocked response is validated against the route's response schema
 * (open enums tolerant, as a newer server may add values), so fixtures cannot drift from the contract.
 * Calls are recorded for assertions.
 */
import { randomBytes } from "node:crypto";
import { type AnyRoute, PUBLIC_ROUTES, pathMatcher, type Role, safeParseTolerant } from "@nearpay/spec";
import type { Page, Route } from "@playwright/test";
import {
  type AccountT,
  ASSETS,
  account,
  agentPayment,
  apiKey,
  type DeliveryT,
  type DestinationT,
  delivery,
  destination,
  type EndpointT,
  endpoint,
  intent,
  intentEvent,
  NOW,
  newId,
  pingEvent,
  secretFor,
  session,
  statementLine,
} from "./fixtures";

export interface Call {
  readonly routeId: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly query: Record<string, unknown>;
  readonly body: unknown;
}

/** `raw`: a non-JSON success body (PDF downloads, SSE streams) sent as is. */
type Reply = {
  status: number;
  body?: unknown;
  raw?: { contentType: string; body: string | Buffer; headers?: Record<string, string> };
};

// static paths win over parameters, like the gateway (`/v1/events/stream` before `/v1/events/{id}`)
const matchers = PUBLIC_ROUTES.map((r) => ({
  route: r,
  re: pathMatcher(r.path),
  names: [...r.path.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] as string),
})).sort((a, b) => a.names.length - b.names.length);

function parseQuery(search: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of new URLSearchParams(search)) {
    const list = rawKey.endsWith("[]");
    const key = list ? rawKey.slice(0, -2) : rawKey;
    const prev = out[key];
    out[key] = list ? [...((prev as string[]) ?? []), value] : value;
  }
  return out;
}

const err = (status: number, type: string, code: string, message = code): Reply => ({
  status,
  body: {
    error: { type, code, message, doc_url: `https://docs.nearpay.money/errors/${code}`, request_id: newId("req") },
  },
});
const list = <T>(url: string, data: T[]) => ({ object: "list", data, has_more: false, url });
const b64u = (n: number) => randomBytes(n).toString("base64url");

export class MockApi {
  readonly calls: Call[] = [];
  signedIn = false;
  role: Role = "owner";
  csrf = b64u(32);
  stepUpUntil = 0;
  /** Account state (KYB, live). */
  account: AccountT = account();
  liveEnabled = false;
  kybStarted = false;
  destinations: { test: DestinationT[]; live: DestinationT[] } = { test: [], live: [] };
  keys: { test: ReturnType<typeof apiKey>[]; live: ReturnType<typeof apiKey>[] } = { test: [], live: [] };
  endpoints: { test: EndpointT[]; live: EndpointT[] } = { test: [], live: [] };
  intents = {
    test: [
      intent(),
      intent({
        status: "requires_payment",
        amount: 1500,
        description: "Beans 1kg",
        attempts: [],
        succeeded_at: null,
        amount_settled: "0",
      }),
    ],
    live: [] as ReturnType<typeof intent>[],
  };
  agentPayments = {
    test: [
      agentPayment(),
      agentPayment({ kind: "checkout", status: "submitted", tx_hash: null, settled_at: null, resource_url: null }),
    ],
    live: [] as ReturnType<typeof agentPayment>[],
  };
  events = { test: [] as ReturnType<typeof pingEvent>[], live: [] as ReturnType<typeof pingEvent>[] };
  /** Pending attestation challenge per destination id (only the latest one is accepted). */
  challenges = new Map<string, { id: string; standard: "nep413" | "eip191"; message: string; nonce: string | null }>();
  /** Lifetime of issued attestation challenges (negative: already expired, to test re-issue). */
  challengeTtlS = 600;
  /** Delivery log per webhook endpoint id, newest first. */
  deliveries = new Map<string, DeliveryT[]>();
  /** Other accounts of the signed-in user (spec 0.2.0 memberships). */
  memberships: { id: string; display_name: string; role: Role }[] = [];
  readonly unexpected: string[] = [];

  constructor() {
    const first = this.intents.test[0];
    if (first) this.events.test.push(intentEvent(first) as never);
  }

  async install(page: Page): Promise<void> {
    await page.route("**/api/**", (r) => this.handle(r));
    await page.route("https://challenges.cloudflare.com/**", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: "window.turnstile={render:function(el,o){el.setAttribute('data-rendered','1');setTimeout(function(){o.callback('turnstile-test-token')},20);return 'w1';}};",
      }),
    );
    // NEAR Connect wallet manifests (offline): no sandboxed wallets, only the injected test wallet
    await page.route(/raw\.githubusercontent\.com|cdn\.jsdelivr\.net/, (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify({ wallets: [], version: "1.0.0" }) }),
    );
  }

  callsTo(routeId: string): Call[] {
    return this.calls.filter((c) => c.routeId === routeId);
  }

  private async handle(r: Route): Promise<void> {
    const req = r.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, "");
    const m = matchers.find((x) => x.route.method === req.method() && x.re.test(path));
    if (!m) {
      this.unexpected.push(`${req.method()} ${path}`);
      await r.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify(err(404, "invalid_request_error", "resource_missing").body),
      });
      return;
    }
    const segs = path.split("/");
    const tpl = m.route.path.split("/");
    const params: Record<string, string> = {};
    tpl.forEach((t, i) => {
      const k = t.match(/^\{([a-z_]+)\}$/)?.[1];
      if (k) params[k] = decodeURIComponent(segs[i] ?? "");
    });
    const headers = await req.allHeaders();
    const query = parseQuery(url.search);
    let body: unknown;
    const raw = req.postData();
    if (raw) body = JSON.parse(raw);
    this.calls.push({ routeId: m.route.id, method: req.method(), path, headers, query, body });
    const reply =
      this.check(m.route, headers, params, query, body) ?? this.dispatch(m.route, params, query, body, headers);
    if (reply.raw) {
      await r.fulfill({
        status: reply.status,
        contentType: reply.raw.contentType,
        headers: { "x-request-id": newId("req"), ...(reply.raw.headers ?? {}) },
        body: reply.raw.body,
      });
      return;
    }
    if (reply.status < 300 && m.route.response) {
      // tolerant: a test may play a newer server that sends an open-enum value this spec does not list
      const v = safeParseTolerant(m.route.response, reply.body);
      if (!v.success) throw new Error(`mock response for ${m.route.id} violates the spec: ${v.error.message}`);
    }
    await r.fulfill({
      status: reply.status,
      contentType: "application/json",
      headers: { "x-request-id": newId("req") },
      body: reply.body === undefined ? "" : JSON.stringify(reply.body),
    });
  }

  private check(
    route: AnyRoute,
    h: Record<string, string>,
    params: Record<string, string>,
    query: Record<string, unknown>,
    body: unknown,
  ): Reply | null {
    const mode = h["nearpay-mode"];
    if (mode !== "test" && mode !== "live")
      return err(400, "invalid_request_error", "invalid_request", "NearPay-Mode header missing");
    const open = route.auth.includes("anonymous");
    const sessionOnly = route.auth.includes("session") && !open;
    if (!route.auth.includes("session") && !open)
      return err(403, "permission_error", "permission_denied", `${route.id} is not callable with a session`);
    if (sessionOnly || (open && this.signedIn && route.auth.includes("session"))) {
      if (!this.signedIn && sessionOnly) return err(401, "authentication_error", "authentication_required");
      if (route.method !== "GET" && h["x-csrf-token"] !== this.csrf)
        return err(403, "permission_error", "csrf_token_invalid");
      if (route.roles && !route.roles.includes(this.role)) return err(403, "permission_error", "permission_denied");
    }
    if (route.method !== "GET" && route.idempotent && !h["idempotency-key"])
      return err(400, "invalid_request_error", "invalid_request", "Idempotency-Key required");
    if (route.params && !route.params.safeParse(params).success)
      return err(400, "invalid_request_error", "invalid_request", "bad path parameter");
    if (route.query) {
      const q = route.query.safeParse(query);
      if (!q.success)
        return err(400, "invalid_request_error", "invalid_request", `query: ${q.error.issues[0]?.message}`);
    } else if (Object.keys(query).length)
      return err(400, "invalid_request_error", "invalid_request", "unexpected query");
    if (route.body) {
      const b = route.body.safeParse(body ?? {});
      if (!b.success)
        return err(
          400,
          "invalid_request_error",
          "invalid_request",
          `body: ${b.error.issues[0]?.path.join(".")} ${b.error.issues[0]?.message}`,
        );
    }
    if (route.stepUp && this.stepUpUntil <= Math.floor(Date.now() / 1000))
      return err(401, "authentication_error", "step_up_required");
    return null;
  }

  private sessionBody(signIn = true) {
    if (signIn) this.signedIn = true;
    return {
      object: "dashboard_session",
      user: { id: "usr_01jbz9k3m4n5p6q7r8s9t0v1w2", email: "owner@acme.example" },
      account: { id: this.account.id, display_name: this.account.display_name },
      role: this.role,
      csrf_token: this.csrf,
      expires_at: NOW + 7 * 86_400,
    };
  }

  /** A fresh challenge for a pending destination; replaces (invalidates) any earlier one. */
  private issueChallenge(d: DestinationT) {
    const standard = d.address.startsWith("0x") ? "eip191" : "nep413";
    const nonceBuf = randomBytes(32);
    const expiresAt = Math.floor(Date.now() / 1000) + this.challengeTtlS;
    const chl = {
      id: newId("chl"),
      standard,
      message: `NearPay settlement destination\nAccount: ${this.account.id}\nMode: live\nAsset: ${d.asset_id}\nNetwork: ${d.chain}\nAddress: ${d.address}\nNonce: ${nonceBuf.toString("hex")}\nExpires: ${new Date(expiresAt * 1000).toISOString()}`,
      nonce: standard === "nep413" ? nonceBuf.toString("base64") : null,
    } as const;
    this.challenges.set(d.id, chl);
    return {
      id: chl.id,
      message: chl.message,
      signing_standard: chl.standard,
      nonce: chl.nonce,
      recipient: chl.standard === "nep413" ? "nearpay.money" : null,
      expires_at: expiresAt,
    };
  }

  private requirements() {
    const missing: string[] = [];
    if (this.account.kyb_status !== "approved") missing.push("kyb");
    if (!this.destinations.live.some((d) => d.status === "active")) missing.push("destination");
    return { object: "account_requirements", live_enabled: missing.length === 0, missing };
  }

  private dispatch(
    route: AnyRoute,
    params: Record<string, string>,
    query: Record<string, unknown>,
    // biome-ignore lint/suspicious/noExplicitAny: request bodies were validated against the route schema in check()
    body: any,
    h: Record<string, string>,
  ): Reply {
    const mode = h["nearpay-mode"] as "test" | "live";
    const live = mode === "live";
    const ok = (b: unknown, status = route.status): Reply => ({ status, body: b });
    switch (route.id) {
      case "listAssets":
        return ok(ASSETS);
      case "signup":
        return { status: 202 };
      case "verifyMagicLink":
        if (body.token !== "magic-token-0123456789") return err(400, "invalid_request_error", "link_expired");
        return ok({
          object: "registration",
          registration_token: b64u(32),
          email: "owner@acme.example",
          expires_at: NOW + 300,
        });
      case "passkeyRegistrationOptions":
        return ok({
          challenge: b64u(32),
          rp: { id: "localhost", name: "NearPay" },
          user: { id: b64u(16), name: "owner@acme.example", displayName: "owner@acme.example" },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          timeout: 60_000,
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          attestation: "none",
        });
      case "passkeyRegistrationVerify":
        if (body.display_name) this.account = { ...this.account, display_name: body.display_name };
        return ok(this.sessionBody());
      case "passkeyAuthenticationOptions":
      case "stepUpOptions":
        return ok({
          challenge: b64u(32),
          rpId: "localhost",
          timeout: 60_000,
          userVerification: "required",
          allowCredentials: [],
        });
      case "passkeyAuthenticationVerify":
        return ok(this.sessionBody());
      case "getDashboardSession":
        // session-only route: check() already answered 401 without the session cookie
        return ok(this.sessionBody(false));
      case "stepUpVerify":
        this.stepUpUntil = Math.floor(Date.now() / 1000) + 600;
        return ok({ object: "step_up", step_up_until: this.stepUpUntil });
      case "logout":
        this.signedIn = false;
        return { status: 204 };
      case "getAccount":
        return ok({ ...this.account, live_enabled: this.requirements().live_enabled });
      case "getAccountRequirements":
        return ok(this.requirements());
      case "updateAccount": {
        const money =
          body.fee_bearer !== undefined ||
          body.settings?.late_payments !== undefined ||
          body.settings?.underpay_tolerance_bps !== undefined;
        if (money && this.stepUpUntil <= Math.floor(Date.now() / 1000))
          return err(401, "authentication_error", "step_up_required");
        const s = this.account.settings;
        this.account = {
          ...this.account,
          ...(body.display_name ? { display_name: body.display_name } : {}),
          ...(body.country ? { country: body.country } : {}),
          ...(body.fee_bearer ? { fee_bearer: body.fee_bearer } : {}),
          settings: { ...s, ...(body.settings ?? {}), branding: { ...s.branding, ...(body.settings?.branding ?? {}) } },
        };
        return ok(this.account);
      }
      case "startKyb":
        this.kybStarted = true;
        this.account = { ...this.account, kyb_status: "pending" };
        return ok({ object: "kyb_case", status: "pending", vendor_flow_url: null });
      case "listSettlementDestinations":
        return ok(list("/v1/settlement_destinations", this.destinations[mode]));
      case "getSettlementDestination": {
        const d = this.destinations[mode].find((x) => x.id === params.id);
        return d ? ok(d) : err(404, "invalid_request_error", "resource_missing");
      }
      case "createSettlementDestination": {
        if (!live) {
          const d = destination({
            ...body,
            livemode: false,
            status: "active",
            verification: "test",
            is_default: this.destinations.test.length === 0,
          });
          this.destinations.test.push(d);
          return ok(d);
        }
        const d = destination({
          ...body,
          livemode: true,
          status: "pending_verification",
          verification: "signature",
          is_default: false,
          active_at: null,
          fingerprint: "1WZ5-TFJZ-CM",
        });
        this.destinations.live.push(d);
        return ok({ ...d, attestation_challenge: this.issueChallenge(d) });
      }
      case "challengeSettlementDestination": {
        const d = this.destinations[mode].find((x) => x.id === params.id);
        if (!d) return err(404, "invalid_request_error", "resource_missing");
        if (d.status !== "pending_verification") return err(409, "invalid_request_error", "state_conflict");
        return ok({ ...d, attestation_challenge: this.issueChallenge(d) });
      }
      case "attestSettlementDestination": {
        const list_ = this.destinations[mode];
        const i = list_.findIndex((x) => x.id === params.id);
        const chl = this.challenges.get(params.id ?? "");
        if (i < 0 || !chl) return err(404, "invalid_request_error", "resource_missing");
        if (body.challenge_id !== chl.id || body.standard !== chl.standard)
          return err(400, "invalid_request_error", "attestation_invalid");
        if (chl.standard === "nep413" && !body.public_key)
          return err(400, "invalid_request_error", "attestation_invalid");
        const d = {
          ...(list_[i] as DestinationT),
          status: "cooling_off" as const,
          active_at: Math.floor(Date.now() / 1000) + 86_400,
        };
        list_[i] = d;
        this.challenges.delete(params.id ?? "");
        return ok(d);
      }
      case "setDefaultSettlementDestination": {
        const ds = this.destinations[mode];
        for (const d of ds) d.is_default = d.id === params.id;
        return ok(ds.find((d) => d.id === params.id));
      }
      case "disableSettlementDestination": {
        const ds = this.destinations[mode];
        const i = ds.findIndex((d) => d.id === params.id);
        ds[i] = { ...(ds[i] as DestinationT), status: "disabled", disabled_reason: "merchant", is_default: false };
        return ok(ds[i]);
      }
      case "listApiKeys":
        return ok(list("/v1/api_keys", this.keys[mode]));
      case "createApiKey": {
        if (body.livemode !== live)
          return err(400, "invalid_request_error", "invalid_request", "livemode must match the mode");
        const secret = secretFor(body.type, live);
        const k = apiKey({
          type: body.type,
          name: body.name,
          livemode: live,
          scopes: body.scopes ?? [],
          ip_allowlist: body.ip_allowlist ?? [],
          display_prefix: secret.slice(0, 8),
          last4: secret.slice(-4),
        });
        this.keys[mode].push(k);
        return ok({ ...k, secret });
      }
      case "rollApiKey": {
        const old = this.keys[mode].find((k) => k.id === params.id);
        if (!old) return err(404, "invalid_request_error", "resource_missing");
        const secret = secretFor(old.type as "secret", live).replace("A1b2", "Z9y8");
        const k = apiKey({
          type: old.type,
          name: old.name,
          livemode: live,
          display_prefix: old.display_prefix,
          last4: secret.slice(-4),
        });
        this.keys[mode] = this.keys[mode].filter((x) => x.id !== old.id || body.expire_old_in_seconds > 0);
        this.keys[mode].push(k);
        return ok({ ...k, secret });
      }
      case "revokeApiKey":
        this.keys[mode] = this.keys[mode].filter((k) => k.id !== params.id);
        return { status: 204 };
      case "listWebhookEndpoints":
        return ok(list("/v1/webhook_endpoints", this.endpoints[mode]));
      case "getWebhookEndpoint": {
        const e = this.endpoints[mode].find((x) => x.id === params.id);
        return e ? ok(e) : err(404, "invalid_request_error", "resource_missing");
      }
      case "createWebhookEndpoint": {
        const e = endpoint({
          url: body.url,
          enabled_events: body.enabled_events,
          description: body.description ?? null,
          livemode: live,
        });
        this.endpoints[mode].push(e);
        return ok({ ...e, secret: `whsec_${"Wh5ecRet".repeat(4)}` });
      }
      case "updateWebhookEndpoint": {
        const es = this.endpoints[mode];
        const i = es.findIndex((x) => x.id === params.id);
        const disabled = body.disabled;
        es[i] = {
          ...(es[i] as EndpointT),
          status: disabled ? "disabled" : "enabled",
          disabled_reason: disabled ? "merchant" : null,
        };
        return ok(es[i]);
      }
      case "listWebhookEndpointDeliveries": {
        if (!this.endpoints[mode].some((x) => x.id === params.id))
          return err(404, "invalid_request_error", "resource_missing");
        const all = this.deliveries.get(params.id ?? "") ?? [];
        const limit = Number(query.limit ?? 10);
        const from = query.starting_after ? all.findIndex((x) => x.id === query.starting_after) + 1 : 0;
        const data = all.slice(from, from + limit);
        return ok({
          object: "list",
          data,
          has_more: from + limit < all.length,
          url: `/v1/webhook_endpoints/${params.id}/deliveries`,
        });
      }
      case "deleteWebhookEndpoint":
        this.endpoints[mode] = this.endpoints[mode].filter((x) => x.id !== params.id);
        return { status: 204 };
      case "testWebhookEndpoint": {
        const evt = pingEvent(params.id ?? "");
        this.events[mode].unshift(evt);
        return ok(evt);
      }
      case "listEvents": {
        const t = query.type as string | undefined;
        return ok(
          list(
            "/v1/events",
            this.events[mode].filter((e) => !t || e.type === t),
          ),
        );
      }
      case "getEvent": {
        const e = this.events[mode].find((x) => x.id === params.id);
        return e ? ok(e) : err(404, "invalid_request_error", "resource_missing");
      }
      case "listPaymentIntents": {
        const s = query.status as string | undefined;
        return ok(
          list(
            "/v1/payment_intents",
            this.intents[mode].filter((p) => !s || p.status === s),
          ),
        );
      }
      case "getPaymentIntent": {
        const p = this.intents[mode].find((x) => x.id === params.id);
        return p ? ok(p) : err(404, "invalid_request_error", "resource_missing");
      }
      case "getCheckoutSession": {
        const p = this.intents[mode].find((x) => x.checkout_session === params.id);
        return p ? ok(session(p.id, params.id as string)) : err(404, "invalid_request_error", "resource_missing");
      }
      case "listBalanceTransactions": {
        const p = this.intents[mode].find((x) => x.id === query.payment_intent);
        return ok(list("/v1/balance_transactions", p && p.status === "succeeded" ? [statementLine(p)] : []));
      }
      case "listAgentPayments": {
        const k = query.kind as string | undefined;
        return ok(
          list(
            "/v1/agent_payments",
            this.agentPayments[mode].filter((p) => !k || p.kind === k),
          ),
        );
      }
      case "getAgentPayment": {
        const p = this.agentPayments[mode].find((x) => x.id === params.id);
        return p ? ok(p) : err(404, "invalid_request_error", "resource_missing");
      }
      // stage 2 — dashboard-core (spec 0.2.0); feature areas install fuller mocks over these
      case "listRefunds":
        return ok(list("/v1/refunds", []));
      case "listMemberships":
        return ok({
          object: "list",
          data: [
            {
              object: "membership",
              account: { id: this.account.id, display_name: this.account.display_name },
              role: this.role,
              current: true,
            },
            ...this.memberships.map((m) => ({
              object: "membership",
              account: { id: m.id, display_name: m.display_name },
              role: m.role,
              current: false,
            })),
          ],
        });
      case "switchSessionAccount": {
        const m = this.memberships.find((x) => x.id === body.account);
        if (!m) return err(403, "permission_error", "permission_denied");
        this.memberships = [
          ...this.memberships.filter((x) => x.id !== m.id),
          { id: this.account.id, display_name: this.account.display_name, role: this.role },
        ];
        this.account = { ...this.account, id: m.id as never, display_name: m.display_name };
        this.role = m.role;
        this.stepUpUntil = 0;
        return ok(this.sessionBody(false));
      }
      case "approveSettlementDestination": {
        const ds = this.destinations[mode];
        const i = ds.findIndex((d) => d.id === params.id);
        const d = ds[i];
        if (!d) return err(404, "invalid_request_error", "resource_missing");
        if (d.status !== "pending_approval") return err(409, "invalid_request_error", "state_conflict");
        const me = "usr_01jbz9k3m4n5p6q7r8s9t0v1w2";
        const a = d.approval ?? { required: 2, approved_by: [], rejected_by: null };
        if (a.approved_by.includes(me as never))
          return err(403, "permission_error", "approver_conflict", "Another owner or admin must approve.");
        if (body.decision === "reject") {
          ds[i] = {
            ...d,
            status: "disabled",
            disabled_reason: "merchant",
            approval: { ...a, rejected_by: me as never },
          };
          return ok(ds[i]);
        }
        const approved_by = [...a.approved_by, me as never];
        const done = approved_by.length >= a.required;
        ds[i] = {
          ...d,
          approval: { ...a, approved_by },
          status: done ? "cooling_off" : "pending_approval",
          active_at: done ? Math.floor(Date.now() / 1000) + 86_400 : null,
        };
        return ok(ds[i]);
      }
      case "updateApiKey": {
        const ks = this.keys[mode];
        const i = ks.findIndex((k) => k.id === params.id);
        const k = ks[i];
        if (!k) return err(404, "invalid_request_error", "resource_missing");
        if (body.scopes && k.type !== "restricted") return err(409, "invalid_request_error", "state_conflict");
        ks[i] = {
          ...k,
          ...(body.name ? { name: body.name } : {}),
          ...(body.scopes ? { scopes: body.scopes } : {}),
          ...(body.ip_allowlist ? { ip_allowlist: body.ip_allowlist } : {}),
        };
        return ok(ks[i]);
      }
      case "rotateWebhookEndpointSecret": {
        const es = this.endpoints[mode];
        const i = es.findIndex((x) => x.id === params.id);
        if (i < 0) return err(404, "invalid_request_error", "resource_missing");
        const exp = body.expire_previous_in_seconds ?? 86_400;
        es[i] = {
          ...(es[i] as EndpointT),
          previous_secret_expires_at: exp ? Math.floor(Date.now() / 1000) + exp : null,
        };
        return ok({ ...es[i], secret: `whsec_${"R0tAtEd1".repeat(4)}` });
      }
      case "resendEvent": {
        const e = this.events[mode].find((x) => x.id === params.id);
        const known = [...this.deliveries.values()].flat().some((d) => d.event === params.id);
        if (!e && !known) return err(404, "invalid_request_error", "resource_missing");
        const targets = body.endpoint
          ? [body.endpoint as string]
          : this.endpoints[mode].filter((x) => x.status === "enabled").map((x) => x.id);
        const deliveries = targets.map((we) =>
          delivery(we, {
            event: params.id as never,
            status: "pending",
            attempts: 0,
            last_status_code: null,
            succeeded_at: null,
            next_attempt_at: Math.floor(Date.now() / 1000) + 5,
          }),
        );
        for (const d of deliveries)
          this.deliveries.set(d.webhook_endpoint, [d, ...(this.deliveries.get(d.webhook_endpoint) ?? [])]);
        return ok({ object: "event_resend", event: params.id, deliveries });
      }
      default:
        this.unexpected.push(route.id);
        return err(500, "api_error", "api_error", `mock: ${route.id} not implemented`);
    }
  }
}
