/**
 * Pure refund logic (lld/dashboard-and-console.md §1 "Wallet signing", lld/payments.md §5/§17):
 * refundable amounts, amount parsing, status vocabulary, the activity trail, and the consistency
 * checks run on a `next_action` before anything is signed. Integer money only (INV-5): amounts are
 * bigint / base-unit strings, never floats.
 */
import type { PaymentIntent, Refund, RefundNextAction } from "@nearpay-money/spec";

export type Attempt = PaymentIntent["attempts"][number];
export type Leg = Refund["legs"][number];
export type SignAndSend = Extract<RefundNextAction, { type: "sign_and_send" }>;
export type SignIntent = Extract<RefundNextAction, { type: "sign_intent" }>;

const big = (s: string | null | undefined): bigint => (s && /^\d+$/.test(s) ? BigInt(s) : 0n);

/** The settled attempt that paid the intent (attempts are newest first). */
export function payingAttempt(intent: Pick<PaymentIntent, "attempts">): Attempt | undefined {
  return intent.attempts.find((a) => a.status === "succeeded" && !a.is_overpayment);
}

/** settled − refunded − pending (lld/payments §5), never below zero. */
export function refundableAmount(
  intent: Pick<PaymentIntent, "amount_settled" | "amount_refunded" | "amount_refund_pending">,
): bigint {
  const v = big(intent.amount_settled) - big(intent.amount_refunded) - big(intent.amount_refund_pending);
  return v > 0n ? v : 0n;
}

/** Intents that can be refunded now: paid, or under review with a settled amount (reject → refund). */
export function canRefund(intent: Pick<PaymentIntent, "status" | "amount_settled">): boolean {
  return intent.status === "succeeded" && big(intent.amount_settled) > 0n;
}

export type ParseResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * `"49.5"` + 6 decimals → `"49500000"`. Accepts digits, an optional decimal point and thousands
 * commas; rejects signs, exponents and more fraction digits than the asset has (string arithmetic).
 */
export function parseUnits(text: string, decimals: number): ParseResult {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return { ok: false, error: "Enter an amount." };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return { ok: false, error: "Enter a number, like 49.00." };
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  if (frac.length > decimals)
    return {
      ok: false,
      error: decimals === 0 ? "This asset has no decimal places." : `Use at most ${decimals} decimal places.`,
    };
  const v = BigInt(`${whole || "0"}${frac.padEnd(decimals, "0")}`);
  return { ok: true, value: v.toString() };
}

/** Base units → plain decimal text for an input (`"49500000"`, 6 → `"49.50"`), no grouping. */
export function unitsToInput(amount: bigint | string, decimals: number, minFraction = 2): string {
  const s = BigInt(amount)
    .toString()
    .padStart(decimals + 1, "0");
  const whole = decimals > 0 ? s.slice(0, -decimals) : s;
  let frac = decimals > 0 ? s.slice(-decimals) : "";
  const keep = Math.min(minFraction, decimals);
  while (frac.length > keep && frac.endsWith("0")) frac = frac.slice(0, -1);
  return frac ? `${whole}.${frac}` : whole;
}

/** Validated refund amount against what is still refundable. */
export function validateRefundAmount(text: string, decimals: number, available: bigint): ParseResult {
  const r = parseUnits(text, decimals);
  if (!r.ok) return r;
  const v = BigInt(r.value);
  if (v <= 0n) return { ok: false, error: "Enter an amount above zero." };
  if (v > available) return { ok: false, error: "That is more than is available to refund." };
  return r;
}

// ---------------------------------------------------------------------------------------------
// Status vocabulary (product/design-system.md §6.1)
// ---------------------------------------------------------------------------------------------

/** Badge label of a refund status (unknown open-enum values render as received). */
export function refundBadge(status: string): string {
  switch (status) {
    case "requires_action":
      return "Not submitted";
    case "pending":
      return "Pending";
    case "succeeded":
      return "Refunded";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return status.replace(/_/g, " ");
  }
}

/** The large "Status" stat on the refund page and its sub-label. */
export function refundStage(r: Pick<Refund, "status" | "next_action" | "legs">): { title: string; sub: string } {
  switch (r.status) {
    case "requires_action": {
      const leg = r.legs[0];
      if (r.next_action) return { title: "Awaiting your wallet", sub: "Approve the return in your wallet" };
      if (leg && leg.status === "expired") return { title: "Signing window closed", sub: "Prepare a new return" };
      return { title: "Preparing", sub: "NearPay is preparing the return route" };
    }
    case "pending":
      return { title: "Confirming", sub: "Do not create another refund" };
    case "succeeded":
      return { title: "Returned", sub: "Verified on the payer's network" };
    case "failed":
      return { title: "Failed", sub: "Funds stayed with or returned to you" };
    case "canceled":
      return { title: "Canceled", sub: "Nothing was sent" };
    default:
      return { title: String(r.status).replace(/_/g, " "), sub: "" };
  }
}

export function legBadge(status: string): string {
  switch (status) {
    case "awaiting_signature":
      return "Not submitted";
    case "submitted":
    case "processing":
      return "Confirming";
    case "succeeded":
      return "Refunded";
    case "returned":
      return "Returned";
    case "failed":
      return "Failed";
    case "expired":
      return "Expired";
    case "held":
      return "Under review";
    default:
      return status.replace(/_/g, " ");
  }
}

export const REASONS = [
  { value: "requested_by_customer", label: "Requested by customer" },
  { value: "duplicate", label: "Duplicate payment" },
  { value: "fraudulent", label: "Fraudulent" },
  { value: "overpayment", label: "Overpayment" },
  { value: "other", label: "Other" },
] as const;

export const FEE_MODES = [
  { value: "payer_absorbs", label: "Deduct from the returned amount" },
  { value: "merchant_absorbs", label: "Add to what I send" },
] as const;

export const reasonLabel = (r: string | null): string =>
  r ? (REASONS.find((x) => x.value === r)?.label ?? r.replace(/_/g, " ")) : "—";

// ---------------------------------------------------------------------------------------------
// Activity trail (Figma "Refund RF–00218": Time · Activity · Details)
// ---------------------------------------------------------------------------------------------

export interface ActivityRow {
  readonly id: string;
  /** Unix seconds, or null for a step that has not happened yet (shown as a "Pending" badge). */
  readonly at: number | null;
  readonly title: string;
  readonly details: string;
  /** Rendered as a status badge instead of a time. */
  readonly pendingLabel?: string;
}

/** Rows oldest → newest; the last row is the outstanding step while the refund is open. */
export function activity(r: Refund): ActivityRow[] {
  const rows: ActivityRow[] = [
    { id: "created", at: r.created, title: "Refund created", details: `Reason: ${reasonLabel(r.reason)}` },
  ];
  for (const leg of [...r.legs].reverse()) {
    const n = r.legs.length > 1 ? ` (route ${leg.number})` : "";
    rows.push({
      id: `leg-${leg.number}`,
      at: leg.created,
      title: `Return prepared${n}`,
      details:
        leg.method === "intents_transfer" ? "NEAR Intents transfer to the payer's account" : "Route back to the payer",
    });
    if (leg.submitted_tx) {
      rows.push({
        id: `leg-${leg.number}-sub`,
        at: null,
        pendingLabel: "Submitted",
        title: "Refund authorized",
        details: "Merchant wallet signed the return",
      });
    }
    switch (leg.status) {
      case "expired":
        rows.push({
          id: `leg-${leg.number}-exp`,
          at: leg.deadline,
          title: "Signing window closed",
          details: "Nothing was sent on this route",
        });
        break;
      case "returned":
        rows.push({
          id: `leg-${leg.number}-ret`,
          at: null,
          pendingLabel: "Returned",
          title: "Transfer returned",
          details: "The route sent the funds back to your settlement wallet",
        });
        break;
      case "failed":
        rows.push({
          id: `leg-${leg.number}-fail`,
          at: null,
          pendingLabel: "Failed",
          title: "Transfer failed",
          details: leg.failure_code ? leg.failure_code.replace(/_/g, " ") : "The route did not complete",
        });
        break;
      case "held":
        rows.push({
          id: `leg-${leg.number}-held`,
          at: null,
          pendingLabel: "Under review",
          title: "Return under review",
          details: "Verification is holding this return",
        });
        break;
      default:
        break;
    }
    if (leg.duplicate) {
      rows.push({
        id: `leg-${leg.number}-dup`,
        at: null,
        pendingLabel: "Review",
        title: "Extra return recorded",
        details: "This route settled after the payer was already refunded",
      });
    }
  }
  if (r.status === "succeeded") {
    rows.push({
      id: "done",
      at: r.succeeded_at,
      title: "Refund complete",
      details: "Return verified on the payer's network",
    });
  } else if (r.status === "pending" || (r.status === "requires_action" && r.legs[0]?.submitted_tx)) {
    rows.push({
      id: "done",
      at: null,
      pendingLabel: "Pending",
      title: "Refund complete",
      details: "Confirmation will appear here",
    });
  } else if (r.status === "canceled") {
    rows.push({
      id: "canceled",
      at: r.canceled_at,
      title: "Refund canceled",
      details: "The reserved amount was released",
    });
  } else if (r.status === "failed") {
    rows.push({
      id: "failed",
      at: null,
      pendingLabel: "Failed",
      title: "Refund failed",
      details: r.failure_code ? r.failure_code.replace(/_/g, " ") : "Prepare the return again to retry",
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// What the merchant may do now (spec route descriptions)
// ---------------------------------------------------------------------------------------------

const currentLeg = (r: Pick<Refund, "legs">): Leg | undefined => r.legs[0];

/** `cancel`: `requires_action` and nothing submitted on the current leg. */
export function canCancel(r: Pick<Refund, "status" | "legs">): boolean {
  return r.status === "requires_action" && !currentLeg(r)?.submitted_tx;
}

/** `prepare`: current leg expired or never prepared (in `requires_action`), or the refund failed. */
export function canPrepare(r: Pick<Refund, "status" | "legs" | "next_action">): boolean {
  if (r.status === "failed") return true;
  if (r.status !== "requires_action" || r.next_action) return false;
  const leg = currentLeg(r);
  return !leg || leg.status === "expired";
}

/** Owner override (INV-7): `requires_action`/`failed` with nothing submitted on the current leg. */
export function canOverrideRecipient(r: Pick<Refund, "status" | "legs">): boolean {
  return (r.status === "requires_action" || r.status === "failed") && !currentLeg(r)?.submitted_tx;
}

/** The refund is moving without merchant input: poll it. */
export function shouldPoll(r: Pick<Refund, "status" | "next_action" | "legs">): boolean {
  if (r.status === "pending") return true;
  if (r.status !== "requires_action") return false;
  const leg = currentLeg(r);
  if (leg?.submitted_tx) return true;
  // no leg yet: a recovery job prepares it after a transient rail failure (prepare is offered too)
  return !r.next_action && (!leg || !canPrepare(r));
}

// ---------------------------------------------------------------------------------------------
// After "Simulate signed transfer" (test mode). The API answers 202 and applies the transfer a moment
// later, so the refund read right after it is still `requires_action` with its `next_action`, a state
// `shouldPoll` does not follow. The page watches the refund until the transfer shows, for a limited time.
// ---------------------------------------------------------------------------------------------

/** How often the refund is read while a simulated transfer is being applied. */
export const SIMULATE_WATCH_INTERVAL_MS = 2000;
/** How long the page waits for a simulated transfer to show before it says so and stops reading. */
export const SIMULATE_WATCH_LIMIT_MS = 120_000;

/** The refund as it was when the simulated transfer was sent, and when that was (ms). */
export interface SimulateWatch {
  readonly status: string;
  readonly sequence: number;
  readonly startedAt: number;
}

export function startSimulateWatch(before: Pick<Refund, "status" | "sequence">, nowMs: number): SimulateWatch {
  return { status: before.status, sequence: before.sequence, startedAt: nowMs };
}

export type SimulateWatchStep = "waiting" | "done" | "timed_out";

/**
 * Where the watch stands for the newest refund read:
 * - `done`: the status changed (pending, succeeded, failed, canceled), or the refund is in a state the
 *   ordinary polling follows by itself (`shouldPoll`, e.g. the transfer is recorded on the leg);
 * - `timed_out`: nothing showed within the limit: stop reading and tell the merchant;
 * - `waiting`: read again. A higher `sequence` alone is shown but does not end the watch, because the
 *   page would stop reading while the refund still asks for a signature.
 */
export function simulateWatchStep(
  w: SimulateWatch,
  r: Pick<Refund, "status" | "next_action" | "legs">,
  nowMs: number,
  limitMs = SIMULATE_WATCH_LIMIT_MS,
): SimulateWatchStep {
  if (r.status !== w.status || shouldPoll(r)) return "done";
  return nowMs - w.startedAt >= limitMs ? "timed_out" : "waiting";
}

/** The newer of two reads of one refund: the higher `sequence` wins (an older read never replaces a newer one). */
export function newerRefund<T extends Pick<Refund, "sequence">>(current: T, next: T): T {
  return next.sequence > current.sequence ? next : current;
}

// ---------------------------------------------------------------------------------------------
// next_action checks — defence in depth before a wallet prompt. The dashboard signs the API's
// payload verbatim (never rebuilt, never edited); these checks only refuse to sign a payload whose
// parts disagree with each other or with the refund (lld/dashboard §1).
// ---------------------------------------------------------------------------------------------

export class NextActionMismatch extends Error {
  constructor(what: string) {
    super(`The prepared return is inconsistent (${what}). Nothing was signed — prepare it again.`);
    this.name = "NextActionMismatch";
  }
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

function parseJson(s: string, what: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    throw new NextActionMismatch(`${what} is not JSON`);
  }
}

/** Throws `NextActionMismatch` unless the action is safe to present for signing. */
export function checkNextAction(
  r: Pick<Refund, "asset_id">,
  a: RefundNextAction,
  nowSec = Math.floor(Date.now() / 1000),
): void {
  if (a.deadline <= nowSec) throw new NextActionMismatch("its signing deadline has passed");
  if (a.type === "sign_and_send") {
    if (BigInt(a.amount) <= 0n) throw new NextActionMismatch("amount is zero");
    if (a.asset_id !== r.asset_id) throw new NextActionMismatch("asset differs from the refund");
    if (a.to.trim() === "" || a.to === a.from) throw new NextActionMismatch("recipient address");
    return;
  }
  const m = a.message;
  if (m.signer_id !== a.signer_id) throw new NextActionMismatch("signer differs");
  if (m.nonce !== a.nep413.nonce) throw new NextActionMismatch("nonce differs");
  if (Date.parse(m.deadline) / 1000 > a.deadline + 1) throw new NextActionMismatch("deadline differs");
  if (m.intents.length !== 1) throw new NextActionMismatch("more than one intent");
  const t = m.intents[0] as { intent: string; receiver_id?: string; tokens?: Record<string, string>; memo?: string };
  const tokens = Object.entries(t.tokens ?? {});
  if (
    t.intent !== "transfer" ||
    t.receiver_id !== a.transfer.receiver_id ||
    tokens.length !== 1 ||
    tokens[0]?.[0] !== a.transfer.token ||
    tokens[0]?.[1] !== a.transfer.amount ||
    t.memo !== a.transfer.memo
  )
    throw new NextActionMismatch("transfer differs from the summary");
  if (a.transfer.token !== r.asset_id) throw new NextActionMismatch("asset differs from the refund");
  if (BigInt(a.transfer.amount) <= 0n) throw new NextActionMismatch("amount is zero");
  // the ERC-191 / raw string carries the whole message; the NEP-413 message carries it without nonce/contract
  if (canonical(parseJson(a.payload, "payload")) !== canonical(m)) throw new NextActionMismatch("payload differs");
  const n = parseJson(a.nep413.message, "NEP-413 message") as Record<string, unknown>;
  if (canonical(n) !== canonical({ signer_id: m.signer_id, deadline: m.deadline, intents: m.intents }))
    throw new NextActionMismatch("NEP-413 message differs");
}

/** How the merchant signs a `sign_intent`: EVM (`0x…` Intents account) or a NEAR wallet. */
export function intentSigner(a: SignIntent): "erc191" | "nep413" | null {
  if (/^0x[0-9a-f]{40}$/.test(a.signer_id) && a.standards.includes("erc191")) return "erc191";
  if (a.standards.includes("nep413")) return "nep413";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------------------------

const CHAINS: Readonly<Record<string, string>> = {
  "near:mainnet": "NEAR",
  "near:testnet": "NEAR testnet",
  "eip155:1": "Ethereum",
  "eip155:8453": "Base",
  "eip155:42161": "Arbitrum",
  "eip155:10": "Optimism",
  "eip155:137": "Polygon",
  "eip155:56": "BNB Chain",
  "eip155:43114": "Avalanche",
  "eip155:100": "Gnosis",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Solana",
  "bip122:000000000019d6689c085ae165831e93": "Bitcoin",
};

/** `eip155:8453` → `Base`; unknown chains render as received. */
export const chainLabel = (chain: string): string => CHAINS[chain] ?? chain;

/** `RF–4K2M` style short reference from an id (display only; the full id stays available). */
export function shortRef(prefix: "RF" | "NP", id: string): string {
  const tail = id.split("_").pop() ?? id;
  return `${prefix}–${tail.slice(-6).toUpperCase()}`;
}
