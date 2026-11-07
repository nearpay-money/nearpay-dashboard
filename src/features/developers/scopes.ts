/**
 * Restricted-key permissions (spec `KEY_SCOPES`, identity §6): one row per resource with the levels the
 * spec defines (`read`, `write` — write implies read — or a single action such as `facilitate`).
 */
import { KEY_SCOPES } from "@nearpay/spec";

export interface ScopeResource {
  /** `"payment_intents"`. */
  readonly resource: string;
  /** Human label, `"Payment intents"`. */
  readonly label: string;
  /** Levels in increasing power, e.g. `["read", "write"]` or `["facilitate"]`. */
  readonly levels: readonly string[];
}

const LABELS: Readonly<Record<string, string>> = {
  checkout_sessions: "Checkout sessions",
  payment_intents: "Payments",
  refunds: "Refunds",
  payment_links: "Payment links",
  customers: "Customers",
  invoices: "Invoices",
  subscriptions: "Subscriptions",
  products: "Products",
  webhook_endpoints: "Webhook endpoints",
  events: "Events",
  destinations: "Settlement destinations",
  balance_transactions: "Statement",
  agentpay: "Agent payments (x402)",
};

const ORDER = ["read", "write"];

/** Resources and their levels from a scope list (default: the spec's `KEY_SCOPES`). */
export function scopeResources(scopes: readonly string[] = KEY_SCOPES): ScopeResource[] {
  const map = new Map<string, string[]>();
  for (const s of scopes) {
    const i = s.lastIndexOf(".");
    if (i <= 0) continue;
    const r = s.slice(0, i);
    const lvl = s.slice(i + 1);
    map.set(r, [...(map.get(r) ?? []), lvl]);
  }
  return [...map.entries()].map(([resource, levels]) => ({
    resource,
    label: LABELS[resource] ?? resource.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    levels: [...levels].sort((a, b) => (ORDER.indexOf(a) + 1 || 9) - (ORDER.indexOf(b) + 1 || 9)),
  }));
}

/** Per-resource level → the scopes to send (`write` alone stands for read + write). */
export function scopesFromLevels(levels: Readonly<Record<string, string>>): string[] {
  return Object.entries(levels)
    .filter(([, l]) => l && l !== "none")
    .map(([r, l]) => `${r}.${l}`)
    .sort();
}

/** A key's scopes → per-resource level (the most powerful one listed). */
export function levelsFromScopes(scopes: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of scopes) {
    const i = s.lastIndexOf(".");
    if (i <= 0) continue;
    const r = s.slice(0, i);
    const l = s.slice(i + 1);
    if (!out[r] || (out[r] === "read" && l === "write")) out[r] = l;
  }
  return out;
}

/** `"Payments: write · Refunds: read"`, or `"2 permissions"` when long. */
export function describeScopes(scopes: readonly string[], max = 2): string {
  const levels = levelsFromScopes(scopes);
  const res = scopeResources(KEY_SCOPES);
  const parts = Object.entries(levels).map(([r, l]) => `${res.find((x) => x.resource === r)?.label ?? r}: ${l}`);
  if (parts.length === 0) return "No permissions";
  return parts.length <= max ? parts.join(" · ") : `${parts.length} permissions`;
}
