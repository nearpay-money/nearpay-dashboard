/**
 * Payout-wallet activation copy. Owner decision 2026-11-11 (final): a payout wallet is active the moment
 * its ownership is verified (and, when a second owner/admin must approve, the moment the last approval
 * lands) — there is no waiting period by default. An operator can still configure a delay in identity
 * (`NP_COOLOFF_SECONDS` > 0, status `cooling_off`); the UI then shows neutral "activating" copy derived
 * from the destination's own `active_at`, and never speaks of a hold or a waiting policy.
 */
import type { SettlementDestination } from "@nearpay-money/spec";
import { formatDate } from "../../lib/format";

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

/** Short status line for an activating (`cooling_off`) destination: `"Activates in about 3 hours"` or `"Activating now"`. */
export function activationStatus(activeAt: number | null | undefined, now: number): string {
  const wait = secondsUntilActive(activeAt, now);
  return wait > 0 ? `Activates in ${aboutDuration(wait)}` : "Activating now";
}

/**
 * Announcement after approving a destination, from the server's answer: `"Main approved. Payout wallet
 * active."` (the default), or, with an operator-configured delay, `"Main approved. It becomes active in
 * about 2 hours."` / `"… It is activating now."`.
 */
export function approvalNotice(
  label: string,
  d: Pick<SettlementDestination, "status" | "active_at">,
  now = Math.floor(Date.now() / 1000),
): string {
  if (d.status === "active") return `${label} approved. Payout wallet active.`;
  if (d.status === "disabled") return `${label} approved, but it didn't pass screening and was disabled.`;
  if (d.status !== "cooling_off") return `${label} approved.`;
  const wait = secondsUntilActive(d.active_at, now);
  return wait > 0
    ? `${label} approved. It becomes active in ${aboutDuration(wait)}.`
    : `${label} approved. It is activating now.`;
}
