/**
 * Audit log feature module (lld/dashboard-and-console.md §1 Stage 2 "audit log + CSV export"):
 * routes + nav metadata for the core route registry.
 */
import { listAccountAuditEvents, type Role } from "@nearpay/spec";
import { createElement, type ReactElement } from "react";
import { AuditLog } from "./AuditLog";

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
    name: "settings-audit",
    pattern: "/settings/audit",
    title: "Audit log",
    crumb: "Settings",
    nav: "settings",
    roles: listAccountAuditEvents.roles,
    render: () => createElement(AuditLog),
  },
];

export const nav: readonly FeatureNavItem[] = [
  {
    id: "settings-audit",
    label: "Audit log",
    href: "/settings/audit",
    group: "settings",
    order: 4,
    roles: listAccountAuditEvents.roles,
  },
];
