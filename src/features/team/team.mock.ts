/** E2E mock of team, invitations, approvals (feature extension of test/e2e/mock-api.ts). Test-only. */
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
}
export type Reply = { status: number; body?: unknown };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const fail = (status: number, code: string, type = "invalid_request_error"): Reply => ({
  status,
  body: { error: { type, code, message: code, request_id: newId("req") } },
});
const list = (url: string, data: unknown[]) => ({ object: "list", data, has_more: false, url });

export class TeamMock {
  members: Record<string, unknown>[] = [];
  invitations: Record<string, unknown>[] = [];
  pending: Record<string, unknown>[] = [];

  constructor(ownerId: string) {
    this.members = [
      {
        object: "member",
        user: { id: ownerId, email: "owner@acme.example" },
        role: "owner",
        created: NOW - 9e5,
        last_login_at: NOW - 60,
      },
      {
        object: "member",
        user: { id: newId("usr"), email: "riya@acme.example" },
        role: "admin",
        created: NOW - 8e5,
        last_login_at: NOW - 3600,
      },
      {
        object: "member",
        user: { id: newId("usr"), email: "sam@acme.example" },
        role: "finance",
        created: NOW - 7e5,
        last_login_at: null,
      },
    ];
  }

  seedPending(approvedBy: string) {
    const d = {
      id: newId("sd"),
      object: "settlement_destination",
      created: NOW - 600,
      livemode: true,
      asset_id: USDC_NEAR,
      type: "intents_account",
      chain: "near:mainnet",
      address: "treasury.acme.near",
      label: "Treasury",
      status: "pending_approval",
      verification: "signature",
      fingerprint: "7KQ2-M9XA-31",
      is_default: true,
      active_at: null,
      min_payment_amount: null,
      per_payment_cap: null,
      disabled_reason: null,
      approval: { required: 2, approved_by: [approvedBy], rejected_by: null },
    };
    this.pending.push(d);
    return d;
  }

  handle(c: MockCtx): Reply | undefined {
    switch (c.routeId) {
      case "listMembers":
        return ok(list("/v1/account/members", this.members));
      case "listInvitations":
        return ok(
          list(
            "/v1/account/invitations",
            this.invitations.filter((i) => !c.query.status || i.status === c.query.status),
          ),
        );
      case "createInvitation": {
        if (this.members.some((m) => (m.user as { email: string }).email === c.body.email))
          return fail(409, "member_exists");
        const i = {
          id: newId("inv"),
          object: "invitation",
          created: NOW,
          email: c.body.email,
          role: c.body.role,
          status: "pending",
          invited_by: c.userId,
          expires_at: NOW + 7 * 86_400,
          accepted_at: null,
        };
        this.invitations.push(i);
        return ok(i, 201);
      }
      case "revokeInvitation": {
        const i = this.invitations.find((x) => x.id === c.params.id);
        if (i) i.status = "revoked";
        return { status: 204 };
      }
      case "updateMember": {
        const m = this.members.find((x) => (x.user as { id: string }).id === c.params.user);
        if (!m) return fail(404, "resource_missing");
        if (
          m.role === "owner" &&
          c.body.role !== "owner" &&
          this.members.filter((x) => x.role === "owner").length === 1
        )
          return fail(409, "last_owner");
        m.role = c.body.role;
        return ok(m);
      }
      case "removeMember":
        this.members = this.members.filter((x) => (x.user as { id: string }).id !== c.params.user);
        return { status: 204 };
      case "listSettlementDestinations":
        if (c.query.status !== "pending_approval") return undefined;
        return ok(list("/v1/settlement_destinations", c.mode === "live" ? this.pending : []));
      case "approveSettlementDestination": {
        const d = this.pending.find((x) => x.id === c.params.id);
        if (!d) return fail(404, "resource_missing");
        const a = d.approval as { approved_by: string[] };
        if (a.approved_by.includes(c.userId)) return fail(403, "approver_conflict", "permission_error");
        this.pending = this.pending.filter((x) => x !== d);
        return ok({
          ...d,
          status: c.body.decision === "approve" ? "cooling_off" : "disabled",
          approval: { ...a, approved_by: [...a.approved_by, c.userId] },
        });
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
