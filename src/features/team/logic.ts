/**
 * Team & approvals logic (lld/identity.md §5 invitations and roles, two-approver rule): role copy, who
 * may grant which role, the merged members + pending-invitations table, and destination approval rows.
 */
import type { Role, SettlementDestination } from "@nearpay-money/spec";

export const ROLE_INFO: Readonly<Record<Role, { label: string; description: string }>> = {
  owner: { label: "Owner", description: "Everything, including business details and owner changes" },
  admin: { label: "Admin", description: "Team, settings, destinations and keys" },
  developer: { label: "Developer", description: "API keys, webhooks and payment links" },
  finance: { label: "Finance", description: "Payments, refunds, customers and payment links" },
  support: { label: "Support", description: "Payments and customer records" },
  viewer: { label: "Viewer", description: "Read-only access" },
};

export const ROLE_ORDER: readonly Role[] = ["owner", "admin", "developer", "finance", "support", "viewer"];

export const roleLabel = (r: string): string => ROLE_INFO[r as Role]?.label ?? r;

/** Roles the signed-in user may grant: only owners grant `owner` (identity §5). */
export function grantableRoles(actor: Role | undefined): Role[] {
  if (actor === "owner") return [...ROLE_ORDER];
  if (actor === "admin") return ROLE_ORDER.filter((r) => r !== "owner");
  return [];
}

/** Whether the actor may change or remove a member with `target` role (admins can't touch owners). */
export function canManage(actor: Role | undefined, target: Role): boolean {
  if (actor === "owner") return true;
  return actor === "admin" && target !== "owner";
}

/** True when the change would leave the account without an owner (the API answers `409 last_owner`). */
export function wouldRemoveLastOwner(
  members: readonly { user: { id: string }; role: Role }[],
  userId: string,
  newRole: Role | null,
): boolean {
  const owners = members.filter((m) => m.role === "owner");
  const target = members.find((m) => m.user.id === userId);
  return target?.role === "owner" && newRole !== "owner" && owners.length <= 1;
}

export interface TeamRow {
  readonly key: string;
  readonly kind: "member" | "invitation";
  readonly email: string;
  readonly role: Role;
  readonly userId?: string;
  readonly invitationId?: string;
  readonly status: string;
  readonly security: string;
  readonly lastLogin?: number | null;
  readonly expiresAt?: number;
}

/** Recovery lock after an email recovery (identity §6: 48 h without destination or team changes). */
export const RECOVERY_LOCK_S = 48 * 3600;

/**
 * Security column (spec 0.2.1 `Member.security`): passkey count and a recent recovery; servers without
 * the summary fall back to "Passkey sign-in" (every dashboard user signs in with a passkey).
 */
export function securityText(
  s: { passkeys: number; recovered_at: number | null } | undefined,
  now = Math.floor(Date.now() / 1000),
): string {
  if (!s) return "Passkey sign-in";
  const keys = s.passkeys === 0 ? "No passkey" : s.passkeys === 1 ? "1 passkey" : `${s.passkeys} passkeys`;
  if (s.recovered_at !== null && s.recovered_at + RECOVERY_LOCK_S > now)
    return `${keys} · recovered, changes locked 48 h`;
  if (s.recovered_at !== null) return `${keys} · recovered by email`;
  return keys;
}

export function teamRows(
  members: readonly {
    user: { id: string; email: string };
    role: Role;
    last_login_at: number | null;
    security?: { passkeys: number; recovered_at: number | null } | undefined;
  }[],
  invitations: readonly { id: string; email: string; role: Role; status: string; expires_at: number }[],
): TeamRow[] {
  const rows: TeamRow[] = members.map((m) => ({
    key: m.user.id,
    kind: "member",
    email: m.user.email,
    role: m.role,
    userId: m.user.id,
    status: "Active",
    security: securityText(m.security),
    lastLogin: m.last_login_at,
  }));
  for (const i of invitations) {
    if (i.status !== "pending") continue;
    rows.push({
      key: i.id,
      kind: "invitation",
      email: i.email,
      role: i.role,
      invitationId: i.id,
      status: "Pending",
      security: "Invitation sent",
      expiresAt: i.expires_at,
    });
  }
  return rows.sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.kind === b.kind ? 0 : a.kind === "member" ? -1 : 1),
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = (s: string): boolean => EMAIL.test(s.trim()) && s.trim().length <= 254;

/** "Approvals 1 of 2 · Owner or admin approval required". */
export function approvalStep(d: Pick<SettlementDestination, "approval">): string {
  const a = d.approval;
  if (!a) return "Approval required";
  const got = a.approved_by.length;
  return `${got} of ${a.required} approvals · another owner or admin must approve`;
}

/** Whether the signed-in user already approved (the API would answer `approver_conflict`). */
export function alreadyApproved(d: Pick<SettlementDestination, "approval">, userId: string | undefined): boolean {
  return Boolean(userId && d.approval?.approved_by.includes(userId as never));
}
