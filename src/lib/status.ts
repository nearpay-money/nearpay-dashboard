/**
 * API status values → the design system's status vocabulary (brain product/design-system.md §6.1):
 * one word or short phrase, sentence case, always shown as text with its tone (never colour alone).
 * Unknown values (open enums from a newer server) render as received, humanized, with a neutral tone.
 */

/** Kit 0.5 tones; `progress` (violet) = still moving (Confirming, Payment detected, Pending). */
export type Tone = "success" | "progress" | "warning" | "danger" | "neutral" | "info";

export type StatusKind =
  | "payment"
  | "attempt"
  | "destination"
  | "endpoint"
  | "delivery"
  | "agent_payment"
  | "kyb"
  | "session"
  | "key"
  | "invoice"
  | "subscription"
  | "cli_login"
  | "mandate"
  | "generic";

type Entry = readonly [label: string, tone: Tone];

const TABLES: Readonly<Record<StatusKind, Readonly<Record<string, Entry>>>> = {
  payment: {
    requires_payment: ["Not paid", "neutral"],
    processing: ["Confirming", "progress"],
    requires_review: ["Review", "warning"],
    succeeded: ["Paid", "success"],
    canceled: ["Canceled", "neutral"],
    expired: ["Expired", "danger"],
  },
  attempt: {
    quoting: ["Quoting", "neutral"],
    awaiting_deposit: ["Awaiting payment", "neutral"],
    deposit_detected: ["Payment detected", "progress"],
    incomplete_deposit: ["Incomplete payment", "warning"],
    processing: ["Confirming", "progress"],
    settling: ["Confirming", "progress"],
    verifying: ["Confirming", "progress"],
    held: ["Under review", "warning"],
    succeeded: ["Complete", "success"],
    failed: ["Failed", "danger"],
    refunded: ["Refunded", "neutral"],
    expired_unpaid: ["Expired", "danger"],
    canceled: ["Canceled", "neutral"],
  },
  destination: {
    pending_verification: ["Awaiting signature", "warning"],
    pending_approval: ["Awaiting approval", "warning"],
    // only with an operator-configured activation delay (no cool-off by default, owner decision 2026-11-11)
    cooling_off: ["Activating", "progress"],
    active: ["Active", "success"],
    disabled: ["Disabled", "neutral"],
  },
  endpoint: {
    enabled: ["Active", "success"],
    disabled: ["Disabled", "neutral"],
  },
  delivery: {
    succeeded: ["Delivered", "success"],
    pending: ["Pending", "progress"],
    failed: ["Failed", "danger"],
    abandoned: ["Abandoned", "danger"],
  },
  agent_payment: {
    settled: ["Paid", "success"],
    submitted: ["Confirming", "progress"],
    pending: ["Pending", "progress"],
    failed: ["Failed", "danger"],
    expired: ["Expired", "danger"],
  },
  kyb: {
    not_started: ["Missing", "neutral"],
    pending: ["Submitted", "info"],
    needs_info: ["Action needed", "warning"],
    approved: ["Live", "success"],
    rejected: ["Not accepted", "danger"],
  },
  session: {
    open: ["Open", "warning"],
    complete: ["Complete", "success"],
    expired: ["Expired", "danger"],
  },
  key: {
    secret: ["Secret", "neutral"],
    publishable: ["Publishable", "neutral"],
    restricted: ["Restricted", "neutral"],
  },
  invoice: {
    draft: ["Draft", "neutral"],
    open: ["Open", "warning"],
    paid: ["Paid", "success"],
    void: ["Void", "neutral"],
    uncollectible: ["Uncollectible", "danger"],
  },
  subscription: {
    incomplete: ["Incomplete", "warning"],
    trialing: ["Trialing", "info"],
    active: ["Active", "success"],
    past_due: ["Past due", "warning"],
    canceled: ["Canceled", "neutral"],
    unpaid: ["Unpaid", "danger"],
  },
  cli_login: {
    pending: ["Awaiting approval", "warning"],
    approved: ["Approved", "success"],
    redeemed: ["Approved", "success"],
    denied: ["Denied", "neutral"],
    expired: ["Expired", "danger"],
  },
  // stage 4 — auto-debit (spec 0.4.0 MandateStatus; "unlinked" = mandateStatusValue)
  mandate: {
    active: ["Active", "success"],
    insufficient: ["Low balance", "warning"],
    exhausted: ["Ended", "neutral"],
    canceled: ["Canceled", "neutral"],
    unlinked: ["Unlinked", "danger"],
  },
  generic: {},
};

const GENERIC: Readonly<Record<string, Tone>> = {
  succeeded: "success",
  active: "success",
  complete: "success",
  approved: "success",
  settled: "success",
  pending: "progress",
  processing: "progress",
  failed: "danger",
  rejected: "danger",
  expired: "danger",
  canceled: "neutral",
  disabled: "neutral",
};

/** `"pending_review"` → `"Pending review"`. */
export function humanStatus(value: string): string {
  const s = value.replace(/[_.]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : value;
}

export function statusOf(kind: StatusKind, value: string): { label: string; tone: Tone } {
  const e = TABLES[kind][value];
  if (e) return { label: e[0], tone: e[1] };
  return { label: humanStatus(value), tone: GENERIC[value] ?? "neutral" };
}
