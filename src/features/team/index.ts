/**
 * Team & approvals feature module (lld/dashboard-and-console.md §1 Stage 2 "Team"; Figma b04):
 * routes + nav metadata for the core route registry.
 */
import { listMembers, type Role } from "@nearpay/spec";
import { createElement, type ReactElement } from "react";
import { Team } from "./Team";

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
    name: "settings-team",
    pattern: "/settings/team",
    title: "Team & approvals",
    crumb: "Settings",
    nav: "settings",
    roles: listMembers.roles,
    render: () => createElement(Team),
  },
];

export const nav: readonly FeatureNavItem[] = [
  {
    id: "settings-team",
    label: "Team & approvals",
    href: "/settings/team",
    group: "settings",
    order: 2,
    roles: listMembers.roles,
  },
];
