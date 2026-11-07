/**
 * Payment links feature module (lld/dashboard-and-console.md §1 Stage 2; lld/payments.md §17.11;
 * Figma b01): routes + nav metadata for the core route registry.
 * Route order matters for first-match routers: `/payment-links/new` precedes `/payment-links/:id`.
 */
import { createPaymentLink, getPaymentLink, listPaymentLinks, type Role } from "@nearpay/spec";
import { createElement, type ReactElement } from "react";
import { CreatePaymentLink } from "./CreatePaymentLink";
import { PaymentLinkDetail } from "./PaymentLinkDetail";
import { PaymentLinks } from "./PaymentLinks";

export interface FeatureRoute {
  readonly name: string;
  readonly pattern: string;
  readonly title: string;
  readonly crumb: string;
  readonly nav: string;
  readonly roles?: readonly Role[];
  readonly render: (params: Readonly<Record<string, string>>) => ReactElement;
}

export interface FeatureNavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly group: "workspace" | "settings";
  readonly order: number;
  readonly roles?: readonly Role[];
}

export const routes: readonly FeatureRoute[] = [
  {
    name: "payment-links",
    pattern: "/payment-links",
    title: "Payment links",
    crumb: "Payment links",
    nav: "payment-links",
    roles: listPaymentLinks.roles,
    render: () => createElement(PaymentLinks),
  },
  {
    name: "payment-link-new",
    pattern: "/payment-links/new",
    title: "Create a payment link",
    crumb: "Payment links",
    nav: "payment-links",
    roles: createPaymentLink.roles,
    render: () => createElement(CreatePaymentLink),
  },
  {
    name: "payment-link",
    pattern: "/payment-links/:id",
    title: "Payment link",
    crumb: "Payment links",
    nav: "payment-links",
    roles: getPaymentLink.roles,
    render: (p) => createElement(PaymentLinkDetail, { id: p.id ?? "" }),
  },
];

/** Figma order: Overview, Payments, Payment links (3), Customers (4), Billing, … */
export const nav: readonly FeatureNavItem[] = [
  { id: "payment-links", label: "Payment links", href: "/payment-links", group: "workspace", order: 3 },
];
