/** E2E mock of the KYB routes (feature extension of test/e2e/mock-api.ts). Test-only. */
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
const _list = (url: string, data: unknown[]) => ({ object: "list", data, has_more: false, url });

const EMPTY = {
  legal_name: null,
  country_of_incorporation: null,
  registration_number: null,
  business_type: null,
  website: null,
  business_address: null,
  representative: null,
  expected_monthly_volume: null,
};

export class KybMock {
  /** `NP_KYB_MODE=manual` on the server: submissions wait in `pending`. */
  constructor(readonly manual = false) {}

  kase: Record<string, unknown> = {
    object: "kyb_case",
    status: "not_started",
    vendor_flow_url: null,
    profile: { ...EMPTY },
    editable: true,
    requested_info: null,
    submitted_at: null,
    decided_at: null,
  };

  handle(c: MockCtx): Reply | undefined {
    switch (c.routeId) {
      case "getKyb":
        return ok(this.kase);
      case "updateKybProfile":
        if (!this.kase.editable) return fail(409, "state_conflict");
        this.kase = { ...this.kase, profile: { ...(this.kase.profile as object), ...c.body } };
        return ok(this.kase);
      case "submitKyb": {
        const p = this.kase.profile as Record<string, unknown>;
        // registration number and website are optional (ADR-0024)
        if (Object.entries(p).some(([k, v]) => k !== "website" && k !== "registration_number" && v === null))
          return fail(400, "kyb_profile_incomplete");
        // open onboarding: compliance decides at once (NP_KYB_MODE=auto); `manual` keeps `pending`
        this.kase = {
          ...this.kase,
          status: this.manual ? "pending" : "approved",
          editable: false,
          submitted_at: NOW,
          decided_at: this.manual ? null : NOW,
        };
        return ok(this.kase);
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
    }) ?? base(route, params, query, body, h);
}
