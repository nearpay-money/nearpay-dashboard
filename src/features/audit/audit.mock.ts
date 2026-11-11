/** E2E mock of the account audit log (feature extension of test/e2e/mock-api.ts). Test-only. */
import type { Role } from "@nearpay-money/spec";
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
}
export type Reply = { status: number; body?: unknown };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const _fail = (status: number, code: string, type = "invalid_request_error"): Reply => ({
  status,
  body: { error: { type, code, message: code, request_id: newId("req") } },
});
const list = (url: string, data: unknown[]) => ({ object: "list", data, has_more: false, url });

export class AuditMock {
  events: Record<string, unknown>[] = [];

  constructor(userId: string) {
    const mk = (
      action: string,
      ago: number,
      target: [string, string] | null,
      details: Record<string, unknown> = {},
    ) => ({
      id: newId("aud"),
      object: "audit_event",
      created: NOW - ago,
      account: "acct_01jbz9k3m4n5p6q7r8s9t0v1w2",
      actor: { type: "user", id: userId },
      action,
      target: target ? { type: target[0], id: target[1] } : null,
      details,
    });
    this.events = [
      mk("member.invited", 120, ["invitation", newId("inv")], { role: "admin" }),
      mk("destination.created", 3600, ["settlement_destination", newId("sd")]),
      mk("api_key.rolled", 7200, ["api_key", newId("key")]),
      mk("account.updated", 86_400, null, { fields: ["display_name"] }),
    ];
  }

  handle(c: MockCtx): Reply | undefined {
    if (c.routeId === "listMembers")
      return {
        status: 200,
        body: list("/v1/account/members", [
          {
            object: "member",
            user: { id: c.userId, email: "owner@acme.example" },
            role: "owner",
            created: NOW - 9e5,
            last_login_at: NOW,
          },
        ]),
      };
    if (c.routeId !== "listAccountAuditEvents") return undefined;
    const q = c.query;
    const gte = q["created[gte]"] ? Number(q["created[gte]"]) : 0;
    const lte = q["created[lte]"] ? Number(q["created[lte]"]) : Number.MAX_SAFE_INTEGER;
    return ok(
      list(
        "/v1/account/audit_events",
        this.events.filter(
          (e) =>
            (!q.action || e.action === q.action) &&
            (!q.actor || (e.actor as { id: string }).id === q.actor) &&
            (e.created as number) >= gte &&
            (e.created as number) <= lte,
        ),
      ),
    );
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
    }) ?? base(route, params, query, body, h);
}
