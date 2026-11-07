/**
 * Refunds feature module (lld/dashboard-and-console.md §1, Stage 2; Figma b01): routes and nav
 * metadata for the core route registry, plus `PaymentRefunds` for the payment detail page.
 *
 * Route order matters for first-match routers: list fixed paths before parameterised ones.
 */
import { getRefund, listRefunds, type Role } from "@nearpay/spec";
import { createElement, type ReactElement } from "react";
import { RefundDetail } from "./RefundDetail";
import { RefundsPage } from "./RefundsList";
import { ReviewRefund } from "./ReviewRefund";

export interface FeatureRoute {
  /** Unique route name. */
  readonly name: string;
  /** `/path/:param` pattern for `matchPath`. */
  readonly pattern: string;
  /** Document / page title. */
  readonly title: string;
  /** Top-bar breadcrumb label ("Acme Studio / <crumb>"). */
  readonly crumb: string;
  /** Nav item id to highlight. */
  readonly nav: string;
  /** Roles that may open the page (from the spec read route); undefined = every role. */
  readonly roles?: readonly Role[];
  readonly render: (params: Readonly<Record<string, string>>) => ReactElement;
}

export interface FeatureNavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Sidebar group. */
  readonly group: "workspace" | "settings";
  /** Position hint inside the group (Figma order). */
  readonly order: number;
  readonly roles?: readonly Role[];
}

export const routes: readonly FeatureRoute[] = [
  {
    name: "refunds",
    pattern: "/refunds",
    title: "Refunds",
    crumb: "Payments",
    nav: "payments",
    roles: listRefunds.roles,
    render: () => createElement(RefundsPage),
  },
  {
    name: "refund",
    pattern: "/refunds/:id",
    title: "Refund",
    crumb: "Payments",
    nav: "payments",
    roles: getRefund.roles,
    render: (p) => createElement(RefundDetail, { id: p.id ?? "" }),
  },
  {
    name: "payment-refund",
    pattern: "/payments/:id/refund",
    title: "Review refund",
    crumb: "Payments",
    nav: "payments",
    render: (p) => createElement(ReviewRefund, { paymentId: p.id ?? "" }),
  },
];

/** Refunds live under Payments in the Figma nav: no nav item of their own. */
export const nav: readonly FeatureNavItem[] = [];

export { PaymentRefunds } from "./RefundsList";
