/**
 * KYB / business details feature module (lld/dashboard-and-console.md §1 Stage 2 "KYB"; ADR-0020):
 * routes + nav metadata for the core route registry.
 */
import { getKyb, type Role } from "@nearpay-money/spec";
import { createElement, type ReactElement } from "react";
import { BusinessDetails } from "./BusinessDetails";
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
    name: "settings-business",
    pattern: "/settings/business",
    title: "Business details",
    crumb: "Settings",
    nav: "business",
    roles: getKyb.roles,
    render: () => createElement(BusinessDetails),
  },
];

export const nav: readonly FeatureNavItem[] = [
  {
    id: "settings-business",
    label: "Business details",
    href: "/settings/business",
    group: "settings",
    order: 1,
    roles: getKyb.roles,
  },
];
