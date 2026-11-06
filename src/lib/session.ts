/**
 * Dashboard session state. The session cookie (`__Host-np_session`, HttpOnly) is the credential; the
 * CSRF token comes only in the sign-in response, so it is kept in memory and in `sessionStorage`
 * (this tab only) to survive reloads. A new tab, or a stored session that the API no longer accepts,
 * signs in again with a passkey (spec 0.1.4 has no "current session" route; see brain notes).
 */
import type { DashboardSession as DashboardSessionSchema, z } from "@nearpay/spec";

export type DashboardSession = z.output<typeof DashboardSessionSchema>;

export const STORAGE_KEY = "np.dashboard.session";

export interface SessionStore {
  load(nowSec?: number): DashboardSession | null;
  save(s: DashboardSession): void;
  clear(): void;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isSession(v: unknown): v is DashboardSession {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.object === "dashboard_session" &&
    typeof o.csrf_token === "string" &&
    typeof o.expires_at === "number" &&
    typeof o.role === "string" &&
    typeof (o.user as { email?: unknown } | undefined)?.email === "string" &&
    typeof (o.account as { id?: unknown } | undefined)?.id === "string"
  );
}

export function sessionStore(storage: StorageLike | undefined = globalThis.sessionStorage): SessionStore {
  return {
    load(nowSec = Math.floor(Date.now() / 1000)) {
      if (!storage) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
      } catch {
        parsed = null;
      }
      if (!isSession(parsed) || parsed.expires_at <= nowSec) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    },
    save(s) {
      storage?.setItem(STORAGE_KEY, JSON.stringify(s));
    },
    clear() {
      storage?.removeItem(STORAGE_KEY);
    },
  };
}
