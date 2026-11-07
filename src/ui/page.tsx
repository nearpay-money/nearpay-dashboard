/**
 * Page patterns shared by every dashboard page (core and feature modules): page header, sections,
 * loading / error / empty states, stat rows that never overflow, confirmation dialogs.
 */
import { ArrowLeftIcon, Button, EmptyState, Modal, PageHeader, Skeleton, Stat, StatGroup } from "@nearpay-internal/ui";
import { type ReactNode, useId, useState } from "react";
import { Link } from "../app/context";
import { ErrorNote } from "./ui";

export interface PageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** StatusBadge shown above the title (detail pages). */
  status?: ReactNode;
  /** Right-aligned actions — at most one primary. */
  actions?: ReactNode;
  /** Back link shown above the title on narrow screens ("← Payments"), as in the mobile Figma frames. */
  back?: { label: string; to: string };
  /** Width: `default` 1120 px, `narrow` 720 px (forms). */
  width?: "default" | "narrow";
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function Page({
  title,
  subtitle,
  status,
  actions,
  back,
  width = "default",
  children,
  className,
  ...rest
}: PageProps) {
  return (
    <div
      className={["dash-page", width === "narrow" && "dash-page--narrow", className].filter(Boolean).join(" ")}
      data-testid={rest["data-testid"]}
    >
      {back ? (
        <Link to={back.to} className="dash-back">
          <ArrowLeftIcon size={16} />
          <span>{back.label}</span>
        </Link>
      ) : null}
      <PageHeader title={title} subtitle={subtitle} status={status} actions={actions} />
      {children}
    </div>
  );
}

/** Titled region of a page (`<section aria-labelledby>`), with optional actions and caption. */
export function Section({
  title,
  aside,
  actions,
  children,
  className,
  level = 2,
  "data-testid": testId,
}: {
  title: ReactNode;
  /** Small caption on the right of the title ("1–7 Nov 2026 · USD"). */
  aside?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  level?: 2 | 3;
  "data-testid"?: string;
}) {
  const id = useId();
  const H = level === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby={id}
      className={["dash-section", className].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      <div className="dash-section__head">
        <H id={id} className={level === 2 ? "np-text-h3 dash-section__title" : "np-text-h4 dash-section__title"}>
          {title}
        </H>
        {aside ? <span className="np-text-caption np-text-secondary">{aside}</span> : null}
        {actions ? <div className="dash-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Page-level skeleton: header + stat row + block, with a polite status message. */
export function LoadingState({ what = "Loading", stats = 0 }: { what?: string; stats?: number }) {
  return (
    <div className="dash-page" aria-busy="true">
      <span role="status" className="np-sr-only">
        {what}…
      </span>
      <div className="dash-skeleton-head">
        <Skeleton shape="title" width="50" />
        <Skeleton width="25" />
      </div>
      {stats > 0 ? (
        <div className="dash-stats">
          {Array.from({ length: stats }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <div key={i} className="dash-skeleton-stat">
              <Skeleton width="50" />
              <Skeleton shape="stat" width="75" />
            </div>
          ))}
        </div>
      ) : null}
      <Skeleton shape="block" />
    </div>
  );
}

/** Full-page error with retry (the API message mapped to friendly copy, reference kept for support). */
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: ReactNode }) {
  return (
    <div className="dash-page">
      {title ? <PageHeader title={title} /> : null}
      <ErrorNote error={error} onRetry={onRetry} />
    </div>
  );
}

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  trend?: "up" | "down" | "neutral";
}

/**
 * A row of stats. Columns collapse with the container width and long values wrap inside their cell, so
 * a stat never overflows its row (gallery bug class: "49.49 USDC" in a 3-column grid on narrow widths).
 */
export function StatRow({
  items,
  loading,
  className,
}: {
  items: readonly StatItem[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <StatGroup className={["dash-stats", className].filter(Boolean).join(" ")}>
      {items.map((s, i) => (
        <Stat
          // biome-ignore lint/suspicious/noArrayIndexKey: stat rows are static
          key={i}
          label={s.label}
          value={loading ? <Skeleton shape="stat" width="75" /> : s.value}
          sub={loading ? undefined : s.sub}
          trend={s.trend}
        />
      ))}
    </StatGroup>
  );
}

/** Confirmation dialog for destructive or irreversible actions (replaces `window.confirm`). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  busy,
  error,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      <ErrorNote error={error} />
    </Modal>
  );
}

/** Hook for a ConfirmDialog bound to one pending target. */
export function useConfirm<T>() {
  const [target, setTarget] = useState<T | undefined>(undefined);
  return { target, open: (t: T) => setTarget(t), close: () => setTarget(undefined) };
}

/** Empty state framed like the Figma ("No test payments yet"). */
export function Empty({
  icon,
  title,
  children,
  action,
  footnote,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <EmptyState icon={icon} title={title} action={action} footnote={footnote} className="dash-empty-state">
      {children}
    </EmptyState>
  );
}
