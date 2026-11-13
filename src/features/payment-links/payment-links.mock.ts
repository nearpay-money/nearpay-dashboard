/** E2E mock of the payment-link routes (feature extension of test/e2e/mock-api.ts). Test-only. */
import type { Role } from "@nearpay-money/spec";
import { NOW, newId } from "../../../test/e2e/fixtures";

export interface MockCtx {
  readonly routeId: string;
  readonly mode: "test" | "live";
  readonly params: Record<string, string>;
  readonly query: Record<string, unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: bodies were validated against the route schema
  readonly body: any;
  readonly role: Role;
  readonly userId: string;
  readonly intents: Record<"test" | "live", Array<Record<string, unknown>>>;
  /** Payout wallets of the shared mock, by mode. */
  readonly destinations: Record<"test" | "live", Array<{ id: string; status: string; is_default: boolean }>>;
}
export type Reply = { status: number; body?: unknown };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const fail = (status: number, code: string, message = code, type = "invalid_request_error"): Reply => ({
  status,
  body: { error: { type, code, message, request_id: newId("req") } },
});
const list = (url: string, data: unknown[]) => ({ object: "list", data, has_more: false, url });

export class PaymentLinksMock {
  readonly links = { test: [] as Record<string, unknown>[], live: [] as Record<string, unknown>[] };

  seed(mode: "test" | "live", over: Record<string, unknown> = {}) {
    const id = newId("plink");
    const l = {
      id,
      object: "payment_link",
      created: NOW - 3600,
      livemode: mode === "live",
      active: true,
      url: `https://pay.nearpay.localhost/l/${id}`,
      amount: 4900,
      currency: "usd",
      asset_id: null,
      description: "Acme Pro",
      settlement_destination: null,
      success_url: null,
      session_expires_in: 3600,
      max_uses: null,
      uses: 128,
      collect_email: false,
      metadata: {},
      ...over,
    };
    this.links[mode].push(l);
    return l;
  }

  handle(c: MockCtx): Reply | undefined {
    const all = this.links[c.mode];
    const find = () => all.find((l) => l.id === c.params.id);
    switch (c.routeId) {
      case "listPaymentLinks":
        return ok(
          list(
            "/v1/payment_links",
            all.filter((l) => c.query.active === undefined || String(l.active) === c.query.active),
          ),
        );
      case "getPaymentLink": {
        const l = find();
        return l ? ok(l) : fail(404, "resource_missing");
      }
      case "createPaymentLink": {
        const b = c.body;
        // like the API: the link's payout wallet (the chosen one, else the account default) must be active
        const wallets = c.destinations[c.mode];
        const wallet = b.settlement_destination
          ? wallets.find((d) => d.id === b.settlement_destination)
          : wallets.find((d) => d.is_default);
        if (wallet?.status !== "active")
          return fail(
            409,
            "destination_not_active",
            b.settlement_destination
              ? "The settlement destination is not active."
              : "The account has no active default settlement destination in this mode.",
          );
        const l = this.seed(c.mode, {
          created: NOW,
          amount: b.amount,
          currency: b.currency,
          asset_id: b.asset_id ?? null,
          description: b.description,
          name: b.name ?? null,
          settlement_destination: b.settlement_destination ?? null,
          success_url: b.success_url ?? null,
          max_uses: b.max_uses ?? null,
          collect_email: b.collect_email ?? false,
          uses: 0,
        });
        all.splice(all.indexOf(l), 1);
        all.unshift(l);
        return ok(l, 201);
      }
      case "updatePaymentLink": {
        const l = find();
        if (!l) return fail(404, "resource_missing");
        Object.assign(l, c.body);
        return ok(l);
      }
      default:
        return undefined;
    }
  }
}

/**
 * Plugs a feature mock into the shared `MockApi` without changing it: wraps its route dispatch (requests
 * are still checked — session, CSRF, roles, step-up, schemas — and responses validated against the spec).
 */
export function installFeatureMock(api: object, mock: { handle(c: MockCtx): Reply | undefined }): void {
  type Dispatch = (
    route: { id: string },
    params: Record<string, string>,
    query: Record<string, unknown>,
    body: unknown,
    h: Record<string, string>,
  ) => Reply;
  const a = api as unknown as {
    dispatch: Dispatch;
    role: Role;
    intents: MockCtx["intents"];
    destinations: MockCtx["destinations"];
  };
  const base = a.dispatch.bind(api);
  a.dispatch = (route, params, query, body, h) =>
    mock.handle({
      routeId: route.id,
      mode: h["nearpay-mode"] === "live" ? "live" : "test",
      params,
      query,
      body,
      role: a.role,
      userId: "usr_01jbz9k3m4n5p6q7r8s9t0v1w2",
      intents: a.intents,
      destinations: a.destinations,
    }) ?? base(route, params, query, body, h);
}
