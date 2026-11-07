/** Module-local view states and error copy (loading skeleton, error with retry, role notice). */
import { Button, Callout, Skeleton } from "@nearpay-internal/ui";
import type { ReactNode } from "react";
import { ApiError, StepUpCanceled } from "../../lib/errors";

const COPY: Readonly<Record<string, string>> = {
  intent_not_succeeded: "Only paid payments can be refunded.",
  attempt_not_settled: "That payment attempt has not settled, so it can't be refunded.",
  amount_exceeds_refundable: "The amount is more than is left to refund. Reload to see the current available amount.",
  screening_blocked: "The payer's refund address can't receive this return (blocked by screening). Contact support.",
  screening_unavailable:
    "Address screening is unavailable right now, so the return can't be prepared. Try again shortly.",
  route_unavailable: "No return route is available right now. Try again in a few minutes.",
  pricing_unavailable: "Prices are unavailable right now, so the return can't be quoted. Try again shortly.",
  rail_unavailable: "Returns are paused right now. Try again in a few minutes.",
  asset_unsupported: "This asset can't be returned automatically yet. Contact support.",
  quote_rejected: "The return quote was rejected. Prepare it again.",
  leg_expired: "The signing window closed. Prepare a new return and sign again.",
  signed_intent_mismatch: "The signature didn't match what NearPay prepared. Nothing was sent — prepare a new return.",
  intent_invalid: "The signature was not accepted. Nothing was sent.",
  insufficient_balance: "Your settlement wallet doesn't hold enough to cover this refund.",
  state_conflict: "This refund changed in the meantime. Reload to see its current state.",
  refund_address_invalid: "That address isn't valid on the payer's network.",
  livemode_forbidden: "Simulations only work in test mode.",
  permission_denied: "Your role can't do this. Ask an owner or admin.",
  resource_missing: "We couldn't find this refund in the current mode.",
  invalid_response:
    "NearPay sent a response the dashboard doesn't understand. Reload; contact support if it continues.",
};

/** Friendly copy for an error (API code → sentence; wallet and step-up outcomes; fallback: API message). */
export function errorCopy(e: unknown): string {
  if (e instanceof StepUpCanceled) return "Confirmation canceled. Nothing was changed.";
  if (e instanceof ApiError) {
    const base = COPY[e.code] ?? e.message;
    return e.requestId ? `${base} Reference ${e.requestId}.` : base;
  }
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return "You closed the wallet. The refund stays unapproved.";
  if (e instanceof TypeError) return "Can't reach NearPay. Check your connection and try again.";
  if (e instanceof Error) return e.message;
  return String(e);
}

export function ErrorState({
  error,
  onRetry,
  title = "Something went wrong",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <Callout tone="danger" title={title} role="alert">
      <p>{errorCopy(error)}</p>
      {onRetry && (
        <div className="npf-refunds__retry">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </Callout>
  );
}

/** Inline error under an action (announced, focus stays put). */
export function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="npf-refunds__action-error" role="alert">
      {errorCopy(error)}
    </p>
  );
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="np-stack np-stack--lg" aria-busy="true">
      <p className="np-sr-only" role="status">
        {label}…
      </p>
      <Skeleton shape="title" width="50" />
      <Skeleton shape="text" width="75" />
      <div className="npf-refunds__skeleton-grid">
        <Skeleton shape="stat" />
        <Skeleton shape="stat" />
        <Skeleton shape="stat" />
      </div>
      <Skeleton shape="block" />
    </div>
  );
}

export function RoleNotice({ children }: { children: ReactNode }) {
  return (
    <Callout tone="neutral" title="Not available for your role">
      {children}
    </Callout>
  );
}
