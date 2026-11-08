/** E2E mock of the customer routes (feature extension of test/e2e/mock-api.ts). Test-only. */
import type { Role } from "@nearpay/spec";
import { NOW, newId, USDC_NEAR } from "../../../test/e2e/fixtures";

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
  /** Request headers (lower-case), e.g. `last-event-id` for the events stream. */
  readonly headers?: Record<string, string>;
}
export type Reply = { status: number; body?: unknown };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const fail = (status: number, code: string, type = "invalid_request_error"): Reply => ({
  status,
  body: { error: { type, code, message: code, request_id: newId("req") } },
});
const list = (url: string, data: unknown[]) => ({ object: "list", data, has_more: false, url });

export class CustomersMock {
  readonly customers = { test: [] as Record<string, unknown>[], live: [] as Record<string, unknown>[] };

  seed(mode: "test" | "live", over: Record<string, unknown> = {}) {
    const c = {
      id: newId("cus"),
      object: "customer",
      created: NOW - 86_400,
      livemode: mode === "live",
      email: "billing@northstar.example",
      name: "Northstar Labs",
      description: null,
      wallets: [{ chain: "near:mainnet", address: "northstar.near" }],
      metadata: {},
      ...over,
    };
    this.customers[mode].push(c);
    return c;
  }

  handle(c: MockCtx): Reply | undefined {
    const all = this.customers[c.mode];
    const find = () => all.find((x) => x.id === c.params.id);
    switch (c.routeId) {
      case "listCustomers":
        return ok(
          list(
            "/v1/customers",
            all.filter((x) => !c.query.email || x.email === c.query.email),
          ),
        );
      case "getCustomer": {
        const x = find();
        return x ? ok(x) : fail(404, "resource_missing");
      }
      case "createCustomer": {
        const x = this.seed(c.mode, {
          created: NOW,
          email: null,
          name: null,
          description: null,
          wallets: [],
          ...c.body,
        });
        return ok(x, 201);
      }
      case "updateCustomer": {
        const x = find();
        if (!x) return fail(404, "resource_missing");
        Object.assign(x, c.body);
        return ok(x);
      }
      case "deleteCustomer": {
        const x = find();
        if (!x) return fail(404, "resource_missing");
        all.splice(all.indexOf(x), 1);
        return ok({ id: x.id, object: "customer", livemode: x.livemode, deleted: true });
      }
      default:
        return undefined;
    }
  }
}
export { USDC_NEAR };

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
      headers: h,
    }) ?? base(route, params, query, body, h);
}
