/**
 * What the signed-in user may do, derived from the spec route table (roles) and the live-mode rule
 * (lld/dashboard §1, audit L-DB-02): in live mode, writes are disabled until `live_enabled`, except
 * onboarding (destinations, KYB, account settings) and safety actions (revoke, delete, disable, logout).
 */
import {
  type AnyRoute,
  createApiKey,
  createWebhookEndpoint,
  type Role,
  resendEvent,
  rollApiKey,
  rotateWebhookEndpointSecret,
  testWebhookEndpoint,
  updateApiKey,
  updateWebhookEndpoint,
} from "@nearpay/spec";
import type { Mode } from "./api";

/** Session-callable for this role (ignores key-only routes). */
export function roleAllows(route: Pick<AnyRoute, "auth" | "roles">, role: Role | undefined): boolean {
  if (!route.auth.includes("session")) return false;
  if (!route.roles) return true;
  return role !== undefined && route.roles.includes(role);
}

/** Writes that only make sense once live mode is enabled (Stage 2 adds the writes on the same objects). */
const LIVE_ONLY_WRITES = new Set<string>([
  createApiKey.id,
  rollApiKey.id,
  updateApiKey.id,
  createWebhookEndpoint.id,
  updateWebhookEndpoint.id,
  testWebhookEndpoint.id,
  rotateWebhookEndpointSecret.id,
  resendEvent.id,
]);

/** Why a write is blocked by the live-mode gate, or null. */
export function liveGate(
  route: Pick<AnyRoute, "id" | "method" | "errors">,
  mode: Mode,
  liveEnabled: boolean | undefined,
): string | null {
  if (mode !== "live" || liveEnabled === true || route.method === "GET") return null;
  if (LIVE_ONLY_WRITES.has(route.id) || route.errors.includes("account_not_live")) {
    return "Live mode is not enabled yet: finish the checklist on Home first.";
  }
  return null;
}

/** Combined check for a button: null = allowed, else the reason to show. */
export function blockedReason(
  route: Pick<AnyRoute, "id" | "method" | "errors" | "auth" | "roles">,
  ctx: { role: Role | undefined; mode: Mode; liveEnabled: boolean | undefined },
): string | null {
  if (!roleAllows(route, ctx.role)) return `Your role (${ctx.role ?? "none"}) cannot do this.`;
  return liveGate(route, ctx.mode, ctx.liveEnabled);
}
