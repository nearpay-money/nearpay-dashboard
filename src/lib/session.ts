/**
 * Dashboard session state. The session cookie (`__Host-np_session`, HttpOnly) is the credential; the
 * `DashboardSession` (with its CSRF token) is held in memory only. A reload or a new tab recovers it from
 * the cookie with `GET /v1/auth/session` (spec 0.1.5, CR-15-01); nothing is written to web storage.
 * Builds before 0.1.5 kept the session (incl. the CSRF token) in `sessionStorage`: that copy is removed.
 */
import { type DashboardSession as DashboardSessionSchema, getDashboardSession, type z } from "@nearpay-money/spec";
import type { ApiClient } from "./api";
import { ApiError } from "./errors";

export type DashboardSession = z.output<typeof DashboardSessionSchema>;

/** Where builds before spec 0.1.5 stored the session; read never, only removed. */
export const LEGACY_STORAGE_KEY = "np.dashboard.session";

type StorageLike = Pick<Storage, "removeItem">;

/** Removes the session copy older builds left in `sessionStorage`. */
export function clearLegacySession(storage: StorageLike | undefined = globalThis.sessionStorage): void {
  try {
    storage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // storage may be unavailable (privacy mode); nothing to clear then
  }
}

/**
 * The current session from the cookie, or null when there is none (401) or it has expired. Other
 * failures (network, 5xx) are rethrown so the caller can tell "signed out" from "API unreachable".
 */
export async function restoreSession(
  api: Pick<ApiClient, "call">,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<DashboardSession | null> {
  try {
    const s = await api.call(getDashboardSession);
    return s.expires_at > nowSec ? s : null;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.code === "authentication_required")) return null;
    throw e;
  }
}
