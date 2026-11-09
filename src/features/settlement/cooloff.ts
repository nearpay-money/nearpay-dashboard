/**
 * Settlement-destination cool-off copy. The cool-off length is server configuration (identity
 * `NP_COOLOFF_SECONDS`, 0 in the beta) and no endpoint exposes it, so the UI never states a duration:
 * it derives the wait from the destination's own `active_at`, and generic copy (before a destination
 * exists) speaks of "a short security hold" without a number.
 */
import { formatDate } from "../../lib/format";

/** Generic copy for places with no destination yet (Setup, Add destination, empty states). */
export const SECURITY_HOLD_COPY = "a short security hold";

/** Seconds until `activeAt`, or 0 when it has passed or is now (no waiting). */
export function secondsUntilActive(activeAt: number | null | undefined, now: number): number {
  return activeAt === null || activeAt === undefined ? 0 : Math.max(0, activeAt - now);
}

/** `"less than a minute"`, `"about 1 minute"`, `"about 3 hours"`, `"about 2 days"` for a wait > 0. */
export function aboutDuration(seconds: number): string {
  if (seconds < 60) return "less than a minute";
  const plural = (n: number, unit: string) => `about ${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds < 3600) return plural(Math.round(seconds / 60) || 1, "minute");
  if (seconds < 48 * 3600) return plural(Math.round(seconds / 3600), "hour");
  return plural(Math.round(seconds / 86_400), "day");
}

/** Local `"9 Nov at 14:05"` for an activation time. */
export function activationClock(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(unix).replace(/ \d{4}$/, "")} at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Short status line for a cooling-off destination: `"Activates in about 3 hours"` or `"Activating now"`. */
export function activationStatus(activeAt: number | null | undefined, now: number): string {
  const wait = secondsUntilActive(activeAt, now);
  return wait > 0 ? `Activates in ${aboutDuration(wait)}` : "Activating now";
}

/** Announcement after approving a destination: `"Payout approved. It becomes active in about 3 hours."`. */
export function activationNotice(
  label: string,
  activeAt: number | null | undefined,
  now = Math.floor(Date.now() / 1000),
): string {
  const wait = secondsUntilActive(activeAt, now);
  return wait > 0
    ? `${label} approved. It becomes active in ${aboutDuration(wait)}.`
    : `${label} approved. It is activating now.`;
}
