/** Account audit log (spec 0.2.0 `listAccountAuditEvents`; owner/admin) and the CSV export walk. */
import { listAccountAuditEvents, listMembers } from "@nearpay-money/spec";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/context";
import type { ApiClient } from "../../lib/api";
import { useAsync } from "../../lib/hooks";
import { type AuditEvent, type AuditFilter, EXPORT_LIMIT, filterQuery } from "./logic";

export const PAGE_SIZE = 25;

export function useAuditList(filter: AuditFilter) {
  const app = useApp();
  const [cursors, setCursors] = useState<string[]>([]);
  const key = JSON.stringify(filter);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts at the first page
  useEffect(() => setCursors([]), [key]);
  const after = cursors.at(-1);
  const state = useAsync(
    () =>
      app.api.call(listAccountAuditEvents, {
        query: { limit: PAGE_SIZE, ...filterQuery(filter), ...(after ? { starting_after: after } : {}) },
      }),
    [key, after, app.api],
  );
  const next = useCallback(() => {
    const last = state.data?.data.at(-1);
    if (last) setCursors((c) => [...c, last.id]);
  }, [state.data]);
  return { ...state, page: cursors.length, next, previous: () => setCursors((c) => c.slice(0, -1)) };
}

/** user id → email, for readable actors (best effort). */
export function useMemberEmails() {
  const app = useApp();
  return useAsync(
    () =>
      app.api
        .call(listMembers, { query: { limit: 100 } })
        .then((r) => new Map(r.data.map((m) => [m.user.id, m.user.email] as [string, string])))
        .catch(() => new Map<string, string>()),
    [app.api],
  );
}

/** Walks every page for the filter (newest first), up to `EXPORT_LIMIT` rows. */
export async function exportEvents(
  api: ApiClient,
  filter: AuditFilter,
  onProgress: (n: number) => void,
  signal: { canceled: boolean },
): Promise<{ events: AuditEvent[]; truncated: boolean }> {
  const events: AuditEvent[] = [];
  let after: string | undefined;
  for (;;) {
    if (signal.canceled) throw new Error("Export canceled.");
    const page = await api.call(listAccountAuditEvents, {
      query: { limit: 100, ...filterQuery(filter), ...(after ? { starting_after: after } : {}) },
    });
    events.push(...page.data);
    onProgress(events.length);
    const last = page.data.at(-1);
    if (!page.has_more || !last) return { events, truncated: false };
    if (events.length >= EXPORT_LIMIT) return { events, truncated: true };
    after = last.id;
  }
}
