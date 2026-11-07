/**
 * Customers feature module (lld/dashboard-and-console.md §1 Stage 2; spec `customers`; Figma b03):
 * routes + nav metadata for the core route registry.
 */
import { getCustomer, listCustomers, type Role } from "@nearpay/spec";
import { createElement, type ReactElement } from "react";
import { CustomerDetail } from "./CustomerDetail";
import { Customers } from "./Customers";

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
    name: "customers",
    pattern: "/customers",
    title: "Customers",
    crumb: "Customers",
    nav: "customers",
    roles: listCustomers.roles,
    render: () => createElement(Customers),
  },
  {
    name: "customer",
    pattern: "/customers/:id",
    title: "Customer",
    crumb: "Customers",
    nav: "customers",
    roles: getCustomer.roles,
    render: (p) => createElement(CustomerDetail, { id: p.id ?? "" }),
  },
];

/** Figma order: … Payment links (3), Customers (4), Billing, … */
export const nav: readonly FeatureNavItem[] = [
  { id: "customers", label: "Customers", href: "/customers", group: "workspace", order: 4 },
];
