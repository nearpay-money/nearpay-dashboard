/** Team, invitations and destination-approval calls (spec 0.2.0 identity, step 2.1). */
import {
  approveSettlementDestination,
  createInvitation,
  listInvitations,
  listMembers,
  listSettlementDestinations,
  type Role,
  removeMember,
  revokeInvitation,
  updateMember,
} from "@nearpay-money/spec";
import { useApp } from "../../app/context";
import type { ApiClient } from "../../lib/api";
import { useAsync } from "../../lib/hooks";

/** Every member and pending invitation (walks the cursor; teams are small). */
async function all<T extends { id?: string; user?: { id: string } }>(
  page: (after?: string) => Promise<{ data: T[]; has_more: boolean }>,
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const p = await page(after);
    out.push(...p.data);
    const last = p.data.at(-1);
    if (!p.has_more || !last) break;
    after = last.id ?? last.user?.id;
  }
  return out;
}

export async function loadTeam(api: ApiClient) {
  const [members, invitations] = await Promise.all([
    all((after) => api.call(listMembers, { query: { limit: 100, ...(after ? { starting_after: after } : {}) } })),
    all((after) =>
      api.call(listInvitations, {
        query: { limit: 100, status: "pending", ...(after ? { starting_after: after } : {}) },
      }),
    ),
  ]);
  return { members, invitations };
}

export function useTeam() {
  const app = useApp();
  return useAsync(() => loadTeam(app.api), [app.api]);
}

/** Destinations waiting for a second approver (live mode; test destinations need no approval). */
export function usePendingApprovals() {
  const app = useApp();
  return useAsync(
    () => app.api.call(listSettlementDestinations, { query: { limit: 100, status: "pending_approval" } }),
    [app.api, app.mode],
  );
}

export function useTeamCalls() {
  const { api } = useApp();
  return {
    invite: (email: string, role: Role) => api.call(createInvitation, { body: { email: email.trim(), role } }),
    revoke: (id: string) => api.call(revokeInvitation, { params: { id } }),
    setRole: (user: string, role: Role) => api.call(updateMember, { params: { user }, body: { role } }),
    remove: (user: string) => api.call(removeMember, { params: { user } }),
    decide: (id: string, decision: "approve" | "reject") =>
      api.call(approveSettlementDestination, { params: { id }, body: { decision } }),
  };
}
