/**
 * Stage 2 feature areas (refunds, payment links, customers, team, KYB, audit, appearance) mounted in the
 * core registry. Each area exports `routes` / `nav` from `src/features/<area>/index.ts`; the code is
 * loaded on first use (one chunk per area), so the route table below only carries what the shell needs
 * before loading: pattern, title, section, roles. `test/unit/features.test.ts` checks that this table
 * matches every area's exported routes and nav, so the two cannot drift.
 */
import {
  createPaymentLink,
  getCustomer,
  getKyb,
  getPaymentLink,
  getRefund,
  listAccountAuditEvents,
  listCustomers,
  listMembers,
  listPaymentLinks,
  listRefunds,
  type Role,
  updateAccount,
} from "@nearpay/spec";
import { type ReactElement, Suspense, use } from "react";
import { LoadingState, Page } from "../ui/page";
import { ErrorNote } from "../ui/ui";
import { useApp } from "./context";
import { defineFeature, type FeatureModule, type NavSlot, type RouteParams } from "./registry";

/** What a feature area's `index.ts` exports (shape owned by the feature modules). */
export interface FeatureIndex {
  readonly routes: readonly {
    readonly name: string;
    readonly pattern: string;
    readonly title: string;
    readonly crumb: string;
    readonly nav: string;
    readonly roles?: readonly Role[];
    readonly render: (params: RouteParams) => ReactElement;
  }[];
  readonly nav: readonly {
    readonly id: string;
    readonly label: string;
    readonly href: string;
    readonly group: "workspace" | "settings";
    readonly order: number;
    readonly roles?: readonly Role[];
  }[];
}

export const FEATURE_AREAS = ["refunds", "payment-links", "customers", "team", "kyb", "audit", "appearance"] as const;
export type FeatureArea = (typeof FEATURE_AREAS)[number];

const loaders = import.meta.glob<FeatureIndex>("../features/*/index.ts");
const cache = new Map<FeatureArea, Promise<FeatureIndex>>();

/** Loads (once) the code of a feature area. */
export function loadArea(area: FeatureArea): Promise<FeatureIndex> {
  let p = cache.get(area);
  if (!p) {
    const load = loaders[`../features/${area}/index.ts`];
    p = load ? load() : Promise.reject(new Error(`feature area ${area} is not built`));
    p.catch(() => cache.delete(area)); // a failed chunk load can be retried
    cache.set(area, p);
  }
  return p;
}

export interface AreaRoute {
  readonly area: FeatureArea;
  readonly name: string;
  readonly pattern: string;
  readonly title: string;
  readonly section: NavSlot;
  readonly roles?: readonly Role[];
}

/** Every feature route, in each area's own order (fixed paths before parameters). */
export const AREA_ROUTES: readonly AreaRoute[] = [
  {
    area: "refunds",
    name: "refunds",
    pattern: "/refunds",
    title: "Refunds",
    section: "payments",
    roles: listRefunds.roles,
  },
  {
    area: "refunds",
    name: "refund",
    pattern: "/refunds/:id",
    title: "Refund",
    section: "payments",
    roles: getRefund.roles,
  },
  {
    area: "refunds",
    name: "payment-refund",
    pattern: "/payments/:id/refund",
    title: "Review refund",
    section: "payments",
  },
  {
    area: "payment-links",
    name: "payment-links",
    pattern: "/payment-links",
    title: "Payment links",
    section: "payment-links",
    roles: listPaymentLinks.roles,
  },
  {
    area: "payment-links",
    name: "payment-link-new",
    pattern: "/payment-links/new",
    title: "Create a payment link",
    section: "payment-links",
    roles: createPaymentLink.roles,
  },
  {
    area: "payment-links",
    name: "payment-link",
    pattern: "/payment-links/:id",
    title: "Payment link",
    section: "payment-links",
    roles: getPaymentLink.roles,
  },
  {
    area: "customers",
    name: "customers",
    pattern: "/customers",
    title: "Customers",
    section: "customers",
    roles: listCustomers.roles,
  },
  {
    area: "customers",
    name: "customer",
    pattern: "/customers/:id",
    title: "Customer",
    section: "customers",
    roles: getCustomer.roles,
  },
  {
    area: "team",
    name: "settings-team",
    pattern: "/settings/team",
    title: "Team & approvals",
    section: "settings",
    roles: listMembers.roles,
  },
  {
    area: "kyb",
    name: "settings-business",
    pattern: "/settings/business",
    title: "Business details",
    section: "settings",
    roles: getKyb.roles,
  },
  {
    area: "audit",
    name: "settings-audit",
    pattern: "/settings/audit",
    title: "Audit log",
    section: "settings",
    roles: listAccountAuditEvents.roles,
  },
  {
    area: "appearance",
    name: "settings-appearance",
    pattern: "/settings/appearance",
    title: "Checkout appearance",
    section: "settings",
  },
];

/** Sidebar entries of the areas (Figma slots) and their Settings index cards. */
export const AREA_NAV: readonly { slot: NavSlot; label: string; href: string }[] = [
  { slot: "payment-links", label: "Payment links", href: "/payment-links" },
  { slot: "customers", label: "Customers", href: "/customers" },
];

export const AREA_CARDS = [
  {
    id: "kyb",
    title: "Business details",
    description: "Declare your business to turn on live payments.",
    href: "/settings/business",
    order: 20,
    roles: getKyb.roles,
  },
  {
    id: "team",
    title: "Team & approvals",
    description: "Invite members, set roles and approve sensitive changes.",
    href: "/settings/team",
    order: 10,
    roles: listMembers.roles,
  },
  {
    id: "appearance",
    title: "Checkout appearance",
    description: "Make checkout feel like part of your business.",
    href: "/settings/appearance",
    order: 30,
    roles: updateAccount.roles,
  },
  {
    id: "audit",
    title: "Audit log",
    description: "Who changed what, with CSV export.",
    href: "/settings/audit",
    order: 45,
    roles: listAccountAuditEvents.roles,
  },
] as const;

function Forbidden({ title }: { title: string }) {
  const app = useApp();
  return (
    <Page title={title}>
      <ErrorNote
        error={new Error(`Your role (${app.session?.role ?? "none"}) can't open this page. Ask an owner or admin.`)}
      />
    </Page>
  );
}

function AreaRouteView({ route, params }: { route: AreaRoute; params: RouteParams }) {
  const mod = use(loadArea(route.area));
  const r = mod.routes.find((x) => x.name === route.name);
  if (!r) return <Forbidden title={route.title} />;
  return r.render(params);
}

function AreaRouteBoundary({ route, params }: { route: AreaRoute; params: RouteParams }) {
  const app = useApp();
  const role = app.session?.role;
  if (route.roles && (!role || !route.roles.includes(role))) return <Forbidden title={route.title} />;
  return (
    <Suspense fallback={<LoadingState what={`Loading ${route.title.toLowerCase()}`} />}>
      <AreaRouteView route={route} params={params} />
    </Suspense>
  );
}

export default defineFeature({
  id: "stage2-areas",
  nav: AREA_NAV,
  settingsCards: AREA_CARDS.map(({ roles: _r, ...c }) => c),
  routes: AREA_ROUTES.map((r) => ({
    name: r.name,
    pattern: r.pattern,
    section: r.section,
    title: r.title,
    render: (params: RouteParams) => <AreaRouteBoundary route={r} params={params} />,
  })),
}) satisfies FeatureModule;
