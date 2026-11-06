/** Small UI kit (plain CSS classes; no inline styles beyond CSSOM, CSP-friendly). */
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useState } from "react";
import { describeError } from "../lib/errors";
import { humanize } from "../lib/format";

export function Button({
  variant = "primary",
  busy,
  blocked,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
  /** Reason the action is not allowed (disables the button and shows as tooltip). */
  blocked?: string | null;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant} ${rest.className ?? ""}`}
      disabled={rest.disabled || busy || Boolean(blocked)}
      title={blocked ?? rest.title}
      aria-busy={busy || undefined}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

const TONE: Record<string, string> = {
  succeeded: "ok",
  active: "ok",
  settled: "ok",
  enabled: "ok",
  complete: "ok",
  approved: "ok",
  verified: "ok",
  processing: "info",
  settling: "info",
  verifying: "info",
  deposit_detected: "info",
  awaiting_deposit: "info",
  quoting: "info",
  submitted: "info",
  queued: "info",
  open: "info",
  cooling_off: "warn",
  pending_verification: "warn",
  pending_approval: "warn",
  requires_review: "warn",
  requires_payment: "muted",
  expiring: "warn",
  held: "warn",
  incomplete_deposit: "warn",
  pending: "warn",
  needs_info: "warn",
  not_started: "muted",
  failed: "bad",
  refunded: "muted",
  canceled: "muted",
  expired: "muted",
  expired_unpaid: "muted",
  disabled: "muted",
  rejected: "bad",
  abandoned: "bad",
};

export function Badge({ value, tone }: { value: string; tone?: string }) {
  return <span className={`badge badge-${tone ?? TONE[value] ?? "muted"}`}>{humanize(value)}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="note note-error" role="alert">
      {describeError(error)}
    </div>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "ok" | "error"; children: ReactNode }) {
  return <div className={`note note-${tone}`}>{children}</div>;
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="muted">{what}…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              ×
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** A value shown once (API key or webhook secret) with a copy button. */
export function SecretOnce({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret">
      <p>
        <strong>{label}</strong> — shown only once. Store it now.
      </p>
      <code data-testid="secret-value">{value}</code>
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="mono">{children}</code>;
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pager({
  hasMore,
  canBack,
  onNext,
  onBack,
}: {
  hasMore: boolean;
  canBack: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  if (!hasMore && !canBack) return null;
  return (
    <div className="pager">
      <Button variant="secondary" disabled={!canBack} onClick={onBack}>
        Previous
      </Button>
      <Button variant="secondary" disabled={!hasMore} onClick={onNext}>
        Next
      </Button>
    </div>
  );
}
