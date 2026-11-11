/**
 * Feature registry — the extension point of the dashboard shell (lld/dashboard-and-console.md §1).
 *
 * Every page area is a self-contained module in `src/features/<area>/module.tsx` whose default export is
 * a `FeatureModule` (use `defineFeature`). The shell discovers modules at build time
 * (`import.meta.glob("../features/<area>/module.tsx")`), so adding an area never edits a shared file:
 *
 *   // src/features/refunds/module.tsx
 *   import { defineFeature } from "../../app/registry";
 *   export default defineFeature({
 *     id: "refunds",
 *     routes: [
 *       { name: "refund-new", pattern: "/payments/:id/refund", section: "payments",
 *         title: "Refund payment", render: (p) => <RefundFlow paymentId={p.id ?? ""} /> },
 *     ],
 *   });
 *
 * - `routes`: `pattern` uses `/:param` segments; the shell renders `render(params)` inside the AppShell
 *   (sidebar, breadcrumb "<account> / <section label> / <title>", mode pill), so a page renders only its
 *   content — start it with `<Page>` from `src/ui/page.tsx`. Signed-in routes only.
 * - `nav`: an entry fills one of the fixed sidebar slots (order and labels follow the Figma). A slot
 *   without an entry is not shown. `stage` hides an entry until `FEATURE_STAGE` (build-time
 *   `VITE_NP_STAGE`, default 4) reaches it — Billing is a Stage 3 slot, Auto-debit Stage 4.
 * - `settingsCards`: link cards on the Settings index (`/settings`).
 * - `roles` on a route: the spec read route's roles; other roles get a notice instead of the page.
 * - `layout: "focus"`: a signed-in page without the shell (centred card), e.g. `/cli/authorize`.
 * - Code splitting: wrap page components with `lazyPage(() => import("./Page"), "Page")` from
 *   `src/app/lazy.tsx`, so an area's code loads on first visit (one chunk per area).
 * - `overviewChecklist`: not provided; the Overview checklist links to fixed routes
 *   (`/settings/business` for business details).
 *
 * Shared building blocks for pages (all in this repo, use them instead of re-implementing):
 * - App state: `useApp()` / `Link` (`src/app/context.tsx`) — API client (`app.api.call(route, {params, query, body})`
 *   with CSRF, mode header, Idempotency-Key, step-up replay and tolerant parsing), session + role, mode,
 *   account, requirements, assets, `app.gate(route)` (role + live-mode gate → reason or null), `app.href(path)`.
 * - Data: `useAsync`, `useMutation`, `useCursorList` (`src/lib/hooks.ts`); CSV export `downloadCsv` (`src/lib/csv.ts`);
 *   friendly error copy `friendlyError` (`src/lib/errors.ts`); money `formatPrice`/`formatAsset` (`src/lib/money.ts`).
 * - UI: `@nearpay-internal/ui` components; page patterns in `src/ui/page.tsx` (`Page`, `Section`, `LoadingState`,
 *   `ErrorState`, `ConfirmDialog`, `StatRow`); legacy helpers in `src/ui/ui.tsx` stay supported.
 */
import type { Role } from "@nearpay-money/spec";
import type { ReactNode } from "react";

/** Sidebar slots, in design v2 order (artboard "Dashboard-proposed"; Developers and Settings form a second group). */
export const NAV_SLOTS = [
  "overview",
  "payments",
  "payment-links",
  "subscriptions",
  "customers",
  "agent-payments",
  "settlement",
  "invoices",
  "developers",
  "business",
  "team",
  "settings",
] as const;
export type NavSlot = (typeof NAV_SLOTS)[number];

export type RouteParams = Readonly<Record<string, string>>;

export interface RouteDef {
  /** Unique route name (`"refund-new"`). */
  readonly name: string;
  /** Path pattern with `:param` segments (`"/payments/:id/refund"`). */
  readonly pattern: string;
  /** Sidebar item this page belongs to (highlighted; second breadcrumb item). */
  readonly section: NavSlot;
  /** Page title: document title and, for pages below their section, the last breadcrumb item. */
  readonly title: string | ((params: RouteParams) => string);
  readonly render: (params: RouteParams) => ReactNode;
  /** Hidden until this stage is enabled (`FEATURE_STAGE`). */
  readonly stage?: number;
  /** Roles that may open the page (the spec read route's `roles`); others see a role notice. */
  readonly roles?: readonly Role[];
  /**
   * `shell` (default): inside the workspace shell. `focus`: a centred single-task page without the
   * sidebar (still signed-in only), e.g. `/cli/authorize`.
   */
  readonly layout?: "shell" | "focus";
}

export interface NavEntry {
  readonly slot: NavSlot;
  readonly label: string;
  readonly href: string;
  readonly stage?: number;
}

export interface SettingsCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  /** Sort key on the Settings index (lower first). Defaults to 100. */
  readonly order?: number;
  readonly stage?: number;
}

export interface FeatureModule {
  readonly id: string;
  readonly routes?: readonly RouteDef[];
  readonly nav?: readonly NavEntry[];
  readonly settingsCards?: readonly SettingsCard[];
}

/** Identity helper that type-checks a module definition. */
export function defineFeature(m: FeatureModule): FeatureModule {
  return m;
}

/** Highest product stage whose pages are shown (build-time `VITE_NP_STAGE`, default 4 since step 4.3). */
export const FEATURE_STAGE: number = Number(import.meta.env.VITE_NP_STAGE ?? 4) || 4;

export interface Registry {
  readonly routes: readonly RouteDef[];
  readonly nav: readonly NavEntry[];
  readonly settingsCards: readonly SettingsCard[];
  /** Whether a signed-in route matches this path (e.g. to show a link only when its page exists). */
  hasPath(path: string): boolean;
}

const visible = (stage: number | undefined, max: number) => (stage ?? 1) <= max;

/**
 * Merges modules into one registry: routes in module order (first match wins, so a duplicate pattern is
 * an error), one nav entry per slot in Figma order, settings cards by `order`.
 */
export function buildRegistry(modules: readonly FeatureModule[], stage: number = FEATURE_STAGE): Registry {
  const routes: RouteDef[] = [];
  const names = new Set<string>();
  const patterns = new Set<string>();
  const bySlot = new Map<NavSlot, NavEntry>();
  const cards: SettingsCard[] = [];
  for (const m of modules) {
    for (const r of m.routes ?? []) {
      if (!visible(r.stage, stage)) continue;
      if (names.has(r.name)) throw new Error(`duplicate route name ${r.name} (module ${m.id})`);
      if (patterns.has(r.pattern)) throw new Error(`duplicate route pattern ${r.pattern} (module ${m.id})`);
      names.add(r.name);
      patterns.add(r.pattern);
      routes.push(r);
    }
    for (const n of m.nav ?? []) {
      if (!visible(n.stage, stage) || bySlot.has(n.slot)) continue;
      bySlot.set(n.slot, n);
    }
    for (const c of m.settingsCards ?? []) if (visible(c.stage, stage)) cards.push(c);
  }
  // static segments beat parameters: "/settlement/new" must win over "/settlement/:id"
  routes.sort((a, b) => specificity(b.pattern) - specificity(a.pattern));
  const nav = NAV_SLOTS.flatMap((s) => {
    const e = bySlot.get(s);
    return e ? [e] : [];
  });
  cards.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
  return {
    routes,
    nav,
    settingsCards: cards,
    hasPath: (path) => routes.some((r) => patternMatches(r.pattern, path)),
  };
}

/** Number of static segments, weighted so longer static prefixes sort first; ties keep module order. */
function specificity(pattern: string): number {
  const segs = pattern.split("/").filter(Boolean);
  return segs.reduce((n, s, i) => n + (s.startsWith(":") ? 0 : 2 ** (8 - Math.min(i, 8))), 0);
}

function patternMatches(pattern: string, path: string): boolean {
  const ps = pattern.split("/");
  const xs = (path.split("?")[0] ?? "").replace(/\/+$/, "").split("/");
  if (ps.length !== xs.length) return false;
  return ps.every((p, i) => p.startsWith(":") || p === xs[i]);
}
