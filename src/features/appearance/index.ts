/**
 * Checkout appearance feature module (lld/dashboard-and-console.md §1 "Settings … branding"; Figma b04):
 * routes + nav metadata for the core route registry.
 */
import { type Role, updateAccount } from "@nearpay-money/spec";
import { createElement, type ReactElement } from "react";
import { Appearance } from "./Appearance";

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
    name: "settings-appearance",
    pattern: "/settings/appearance",
    title: "Checkout appearance",
    crumb: "Settings",
    nav: "settings",
    render: () => createElement(Appearance),
  },
];

export const nav: readonly FeatureNavItem[] = [
  {
    id: "settings-appearance",
    label: "Checkout appearance",
    href: "/settings/appearance",
    group: "settings",
    order: 3,
    roles: updateAccount.roles,
  },
];
