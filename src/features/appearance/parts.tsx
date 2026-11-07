/** Module-local view states and error copy (loading skeleton, error with retry, role notice). */
import { Button, Callout, Skeleton } from "@nearpay-internal/ui";
import type { ReactNode } from "react";
import { ApiError, StepUpCanceled } from "../../lib/errors";

const COPY: Readonly<Record<string, string>> = {
  invalid_setting: "One of the settings isn't valid. Check the accent colour (#RRGGBB).",
  permission_denied: "Only owners and admins can change checkout appearance.",
  invalid_response:
    "NearPay sent a response the dashboard doesn't understand. Reload; contact support if it continues.",
  validation_error: "Some fields aren't valid. Check the highlighted fields.",
  invalid_request: "Some fields aren't valid. Check the form and try again.",
};

/** Friendly copy for an error (API code → sentence; step-up outcome; fallback: API message). */
export function errorCopy(e: unknown): string {
  if (e instanceof StepUpCanceled) return "Confirmation canceled. Nothing was changed.";
  if (e instanceof ApiError) {
    const base = COPY[e.code] ?? e.message;
    return e.requestId ? `${base} Reference ${e.requestId}.` : base;
  }
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
        <div className="npf-appearance__retry">
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
    <p className="npf-appearance__action-error" role="alert">
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
      <div className="npf-appearance__skeleton-grid">
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
