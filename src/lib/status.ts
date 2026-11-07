/**
 * API status values → the design system's status vocabulary (brain product/design-system.md §6.1):
 * one word or short phrase, sentence case, always shown as text with its tone (never colour alone).
 * Unknown values (open enums from a newer server) render as received, humanized, with a neutral tone.
 */

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

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
  | "generic";

type Entry = readonly [label: string, tone: Tone];

const TABLES: Readonly<Record<StatusKind, Readonly<Record<string, Entry>>>> = {
  payment: {
    requires_payment: ["Not paid", "warning"],
    processing: ["Confirming", "warning"],
    requires_review: ["Review", "warning"],
    succeeded: ["Paid", "success"],
    canceled: ["Canceled", "neutral"],
    expired: ["Expired", "danger"],
  },
  attempt: {
    quoting: ["Quoting", "neutral"],
    awaiting_deposit: ["Awaiting payment", "warning"],
    deposit_detected: ["Payment detected", "warning"],
    incomplete_deposit: ["Incomplete payment", "warning"],
    processing: ["Confirming", "warning"],
    settling: ["Confirming", "warning"],
    verifying: ["Confirming", "warning"],
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
    cooling_off: ["Cooling off", "warning"],
    active: ["Active", "success"],
    disabled: ["Disabled", "neutral"],
  },
  endpoint: {
    enabled: ["Active", "success"],
    disabled: ["Disabled", "neutral"],
  },
  delivery: {
    succeeded: ["Delivered", "success"],
    pending: ["Pending", "warning"],
    failed: ["Failed", "danger"],
    abandoned: ["Abandoned", "danger"],
  },
  agent_payment: {
    settled: ["Paid", "success"],
    submitted: ["Confirming", "warning"],
    pending: ["Pending", "warning"],
    failed: ["Failed", "danger"],
    expired: ["Expired", "danger"],
  },
  kyb: {
    not_started: ["Not submitted", "warning"],
    pending: ["Under review", "warning"],
    needs_info: ["Action needed", "warning"],
    approved: ["Reviewed", "success"],
    rejected: ["Rejected", "danger"],
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
  generic: {},
};

const GENERIC: Readonly<Record<string, Tone>> = {
  succeeded: "success",
  active: "success",
  complete: "success",
  approved: "success",
  settled: "success",
  pending: "warning",
  processing: "warning",
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
