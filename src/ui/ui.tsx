/**
 * Dashboard UI helpers on top of `@nearpay-internal/ui` (CSP-safe: no inline styles). The names and
 * props of the Stage 1 helpers are kept so feature modules written against them keep working; new code
 * may use the kit components directly and the page patterns in `./page.tsx`.
 */
import {
  Callout,
  CardTitle,
  CheckIcon,
  CopyIcon,
  KeyValueList,
  Button as KitButton,
  Card as KitCard,
  Field as KitField,
  Modal as KitModal,
  Pager as KitPager,
  Skeleton,
  StatusBadge,
} from "@nearpay-internal/ui";
import { type ButtonHTMLAttributes, type ReactNode, useId, useState } from "react";
import { friendlyError } from "../lib/errors";
import { type StatusKind, statusOf, type Tone } from "../lib/status";

const LEGACY_TONE: Readonly<Record<string, Tone>> = {
  ok: "success",
  info: "info",
  warn: "warning",
  bad: "danger",
  muted: "neutral",
};

export function Button({
  variant = "primary",
  size = "md",
  busy,
  blocked,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "sm";
  busy?: boolean;
  /** Reason the action is not allowed (disables the button; shown as its description). */
  blocked?: string | null;
  fullWidth?: boolean;
}) {
  const hintId = useId();
  return (
    <>
      <KitButton
        {...rest}
        className={className}
        variant={variant}
        size={size}
        loading={busy}
        disabled={rest.disabled || Boolean(blocked)}
        title={blocked ?? rest.title}
        aria-describedby={blocked ? hintId : rest["aria-describedby"]}
      >
        {children}
      </KitButton>
      {blocked ? (
        <span id={hintId} className="np-sr-only">
          {blocked}
        </span>
      ) : null}
    </>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  "data-testid": testId,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <KitCard as="section" className={className ? `dash-card ${className}` : "dash-card"} data-testid={testId}>
      {(title || actions) && (
        <header className="dash-card__head">
          {title ? <CardTitle>{title}</CardTitle> : <span />}
          {actions && <div className="dash-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </KitCard>
  );
}

/** Status badge from an API value: vocabulary label + tone (`kind` picks the table). */
export function Badge({ value, tone, kind = "generic" }: { value: string; tone?: string; kind?: StatusKind }) {
  const s = statusOf(kind, value);
  return <StatusBadge tone={tone ? (LEGACY_TONE[tone] ?? (tone as Tone)) : s.tone}>{s.label}</StatusBadge>;
}

/** Error callout (role alert) with friendly copy, the API's message and the request reference. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const f = friendlyError(error);
  return (
    <Callout
      tone="danger"
      role="alert"
      title={f.title}
      reference={f.reference}
      className="dash-error"
      data-testid="error-note"
    >
      {f.detail && f.detail !== f.title ? <p>{f.detail}</p> : null}
      {onRetry && f.retryable !== false ? (
        <button type="button" className="np-link-button dash-retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </Callout>
  );
}

export function Note({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "ok" | "error";
  title?: ReactNode;
  children: ReactNode;
}) {
  const t = tone === "warn" ? "warning" : tone === "ok" ? "success" : tone === "error" ? "danger" : "info";
  return title ? (
    <Callout tone={t} title={title}>
      {children}
    </Callout>
  ) : (
    <Callout tone={t} title={children} />
  );
}

/** Skeleton block with a polite status text (screen readers hear what is loading). */
export function Loading({ what = "Loading", rows = 3 }: { what?: string; rows?: number }) {
  return (
    <div className="dash-loading" aria-busy="true">
      <span role="status" className="np-sr-only">
        {what}…
      </span>
      <Skeleton shape="title" width="50" />
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <Skeleton key={i} width={i % 2 ? "75" : "100"} />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="dash-empty">{children}</p>;
}

/** Labelled control; `children(id)` receives the control id (kit Field wires hint/error). */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <KitField label={label} hint={hint} error={error} required={required} id={id}>
      {children(id)}
    </KitField>
  );
}

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  dismissible = true,
}: {
  title: string;
  description?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
}) {
  return (
    <KitModal
      open
      title={title}
      description={description}
      onClose={onClose ?? (() => {})}
      footer={footer}
      dismissible={dismissible && Boolean(onClose)}
    >
      {children}
    </KitModal>
  );
}

/** A value shown once (API key or webhook secret) with a copy button. */
export function SecretOnce({ label, value, onDone }: { label: string; value: string; onDone?: () => void }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Callout tone="warning" title={`${label} — shown only once`} className="dash-secret" live>
      <p>Store it in your secret manager now. You won't be able to see it again.</p>
      <code className="dash-secret__value" data-testid="secret-value">
        {value}
      </code>
      <div className="np-row">
        <KitButton
          variant="secondary"
          size="sm"
          leadingIcon={copied === "copied" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          onClick={() => {
            navigator.clipboard?.writeText(value).then(
              () => setCopied("copied"),
              () => setCopied("failed"),
            );
          }}
        >
          {copied === "copied" ? "Copied" : "Copy"}
        </KitButton>
        {onDone ? (
          <KitButton variant="ghost" size="sm" onClick={onDone}>
            I've stored it
          </KitButton>
        ) : null}
      </div>
      {copied === "failed" ? <p>Couldn't copy. Select the value and copy it manually.</p> : null}
    </Callout>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code className="dash-mono" title={title}>
      {children}
    </code>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return <KeyValueList items={rows.map(([label, value]) => ({ label, value }))} className="dash-kv" />;
}

export function Pager({
  hasMore,
  canBack,
  onNext,
  onBack,
  summary,
}: {
  hasMore: boolean;
  canBack: boolean;
  onNext: () => void;
  onBack: () => void;
  summary?: ReactNode;
}) {
  if (!hasMore && !canBack) return summary ? <p className="np-pager__summary dash-pager-summary">{summary}</p> : null;
  return <KitPager summary={summary} hasNext={hasMore} hasPrevious={canBack} onNext={onNext} onPrevious={onBack} />;
}
