/**
 * Payout-wallet activation copy. Owner decision 2026-11-11 (final): a payout wallet is active the moment
 * its ownership is verified (and, when a second owner/admin must approve, the moment the last approval
 * lands) — there is no waiting period. Should the API still report a destination as `cooling_off`, the UI
 * says only that it is activating: no countdown, no hold or waiting-period wording (owner, 2026-11-12).
 */
import type { SettlementDestination } from "@nearpay-money/spec";

/** Short status line for a destination the API still reports as `cooling_off`. */
export const ACTIVATING_TEXT = "Activating. It can receive payments once it shows as active.";

/**
 * Announcement after approving a destination, from the server's answer: `"Main approved. Payout wallet
 * active."` (the normal flow), or `"Main approved. It is activating."` while the API reports `cooling_off`.
 */
export function approvalNotice(label: string, d: Pick<SettlementDestination, "status">): string {
  if (d.status === "active") return `${label} approved. Payout wallet active.`;
  if (d.status === "disabled") return `${label} approved, but it didn't pass screening and was disabled.`;
  if (d.status === "cooling_off") return `${label} approved. It is activating.`;
  return `${label} approved.`;
}
