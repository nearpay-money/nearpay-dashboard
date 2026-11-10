/**
 * Top-bar search (design v2): a page and object jumper. v1 has no full-text search endpoint, so the field
 * searches what exists without one — every signed-in page the user's role can open (titles from the route
 * registry, sidebar labels as keywords) — and opens an object directly when a NearPay ID is pasted
 * (`pi_…` → payment, `cus_…` → customer, …; `cs_…` → the payments list filtered by checkout session, an
 * existing ADR-0018 filter). Pure functions here; the combobox lives in `Jump.tsx`.
 */
import type { Role } from "@nearpay/spec";
import type { Registry } from "./registry";

export interface JumpTarget {
  readonly id: string;
  readonly label: string;
  /** Second line ("Page · Billing", "Open payment"). */
  readonly hint: string;
  /** In-app path (mode is added by the caller). */
  readonly path: string;
}

/** ID prefix → where the object opens. Only targets whose route exists in the registry are offered. */
const OBJECT_PATHS: Readonly<Record<string, { path: (id: string) => string; noun: string }>> = {
  pi: { path: (id) => `/payments/${id}`, noun: "payment" },
  cus: { path: (id) => `/customers/${id}`, noun: "customer" },
  plink: { path: (id) => `/payment-links/${id}`, noun: "payment link" },
  re: { path: (id) => `/refunds/${id}`, noun: "refund" },
  in: { path: (id) => `/billing/invoices/${id}`, noun: "invoice" },
  sub: { path: (id) => `/billing/subscriptions/${id}`, noun: "subscription" },
  prod: { path: (id) => `/billing/products/${id}`, noun: "product" },
  md: { path: (id) => `/billing/mandates/${id}`, noun: "auto-debit mandate" },
  evt: { path: (id) => `/developers/events/${id}`, noun: "event" },
  we: { path: (id) => `/developers/webhooks/${id}`, noun: "webhook endpoint" },
  ap: { path: (id) => `/agent-payments/${id}`, noun: "agent payment" },
  cs: { path: (id) => `/payments?checkout_session=${encodeURIComponent(id)}`, noun: "checkout session's payments" },
};

const ID_RE = /^([a-z]+)_[0-9a-z]{6,}$/i;

/** Every static (parameter-free) page the role may open, labelled by its title, deduplicated by path. */
export function jumpPages(registry: Registry, role: Role | undefined): JumpTarget[] {
  const sectionLabel = new Map(registry.nav.map((n) => [n.slot, n.label]));
  const navHref = new Map(registry.nav.map((n) => [n.href, n.label]));
  const out: JumpTarget[] = [];
  const seen = new Set<string>();
  for (const r of registry.routes) {
    if (r.pattern.includes(":") || r.layout === "focus") continue;
    if (r.roles && (!role || !r.roles.includes(role))) continue;
    if (typeof r.title !== "string" || seen.has(r.pattern)) continue;
    seen.add(r.pattern);
    const section = sectionLabel.get(r.section);
    // a sidebar page is called what the sidebar calls it ("Home", "Payout wallets")
    const label = navHref.get(r.pattern) ?? r.title;
    out.push({
      id: `page:${r.pattern}`,
      label,
      hint: section && section !== label ? `Page · ${section}` : "Page",
      path: r.pattern,
    });
  }
  return out;
}

function score(t: JumpTarget, q: string): number {
  const label = t.label.toLowerCase();
  const all = `${label} ${t.hint.toLowerCase()}`;
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (label.split(/[\s/–-]+/).some((w) => w.startsWith(q))) return 2;
  if (all.includes(q)) return 3;
  return -1;
}

/** Results for the query: an object for a pasted ID first, then matching pages (≤ `limit`). */
export function jumpResults(query: string, pages: readonly JumpTarget[], registry: Registry, limit = 8): JumpTarget[] {
  const q = query.trim();
  if (!q) return [];
  const out: JumpTarget[] = [];
  const m = ID_RE.exec(q);
  const obj = m ? OBJECT_PATHS[(m[1] ?? "").toLowerCase()] : undefined;
  if (m && obj) {
    const path = obj.path(q);
    if (registry.hasPath(path)) out.push({ id: `obj:${q}`, label: q, hint: `Open ${obj.noun}`, path });
  }
  const lower = q.toLowerCase();
  const ranked = pages
    .map((p) => ({ p, s: score(p, lower) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.p.label.length - b.p.label.length);
  for (const { p } of ranked) {
    if (out.length >= limit) break;
    out.push(p);
  }
  return out;
}
