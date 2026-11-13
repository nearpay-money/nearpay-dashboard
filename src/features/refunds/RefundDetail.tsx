/**
 * Refund detail (Figma b01 "Refund RF–00218"): amount, return-to, status, the activity table and
 * "View return transaction". Actions follow the spec's state rules: review in wallet (`next_action`),
 * prepare a new route (expired / failed), cancel (nothing submitted), and the owner-only recipient
 * override with step-up (INV-7). Open refunds are polled until they settle. After "Simulate signed
 * transfer" (test mode) the refund is read every 2 s until the transfer shows (at most 2 min, then the page
 * says it is still confirming and offers "Check again"); no reload is needed.
 */

import {
  Button,
  buttonClassName,
  Callout,
  ExternalLinkIcon,
  Field,
  Input,
  LiveRegion,
  Modal,
  Money,
  PageHeader,
  Stat,
  StatGroup,
  StatusBadge,
  Table,
  truncateMiddle,
} from "@nearpay-internal/ui";
import { cancelRefund, prepareRefund, type Refund, updateRefundRecipient } from "@nearpay-money/spec";
import { useEffect, useRef, useState } from "react";
import { Link, useApp } from "../../app/context";
import { explorerTxUrl } from "../../lib/explorer";
import { roleAllows } from "../../lib/permissions";
import { useIntent, useRefund, useRefundCalls } from "./api";
import {
  type ActivityRow,
  activity,
  canCancel,
  canOverrideRecipient,
  canPrepare,
  chainLabel,
  newerRefund,
  refundBadge,
  refundStage,
  SIMULATE_WATCH_INTERVAL_MS,
  type SimulateWatch,
  shortRef,
  shouldPoll,
  simulateWatchStep,
  startSimulateWatch,
} from "./logic";
import { ActionError, ErrorState, PageSkeleton } from "./parts";
import { SignRefund } from "./SignRefund";
import { fmtTime, isoOf, useSpaLinks } from "./ui";
import "./refunds.css";

export const POLL_MS = 5000;

export function RefundDetail({ id }: { id: string }) {
  const r = useRefund(id);
  if (r.loading && !r.data) return <PageSkeleton label="Loading refund" />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={r.reload} title="We couldn't load this refund" />;
  return <RefundView key={r.data.id} initial={r.data} />;
}

function RefundView({ initial }: { initial: Refund }) {
  const app = useApp();
  const calls = useRefundCalls();
  const [refund, setRefund] = useState(initial);
  const [announce, setAnnounce] = useState("");
  const [reviewOpen, setReviewOpen] = useState(
    () => new URLSearchParams(app.location.search).get("review") === "1" && Boolean(initial.next_action),
  );
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const intent = useIntent(refund.payment_intent);
  const root = useRef<HTMLDivElement>(null);
  useSpaLinks(root);

  // a simulated transfer was accepted (test mode) and has not shown on the refund yet
  const [watch, setWatch] = useState<SimulateWatch | null>(null);
  const [watchTimedOut, setWatchTimedOut] = useState(false);
  const latest = useRef({ refund, calls });
  latest.current = { refund, calls };

  // poll while the refund moves without the merchant (preparing, submitted, confirming), and while a
  // simulated transfer is being applied; stops on a final state, on unmount and at the watch's time limit
  const poll = shouldPoll(refund);
  const refundId = refund.id;
  useEffect(() => {
    if (!poll && !watch) return;
    let alive = true;
    const t = setInterval(
      async () => {
        let next: Refund | undefined;
        try {
          next = await latest.current.calls.get(refundId);
        } catch {
          next = undefined; // keep the last known state; read again on the next tick
        }
        if (!alive) return;
        const cur = latest.current.refund;
        const shown = next ? newerRefund(cur, next) : cur;
        if (shown !== cur) {
          if (shown.status !== cur.status) setAnnounce(`Refund status: ${refundBadge(shown.status)}.`);
          setRefund(shown);
        }
        if (!watch) return;
        const step = simulateWatchStep(watch, shown, Date.now());
        if (step === "waiting") return;
        setWatch(null);
        if (step === "timed_out") {
          setWatchTimedOut(true);
          setAnnounce("Still confirming. The simulated transfer hasn't shown on this refund yet.");
        }
      },
      watch ? SIMULATE_WATCH_INTERVAL_MS : POLL_MS,
    );
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [poll, watch, refundId]);

  const update = (next: Refund, message: string, opts?: { readonly simulatedFrom?: Refund }) => {
    setRefund(next);
    setAnnounce(message);
    setReviewOpen(false);
    setWatchTimedOut(false);
    const started = opts?.simulatedFrom ? startSimulateWatch(opts.simulatedFrom, Date.now()) : null;
    setWatch(started && simulateWatchStep(started, next, started.startedAt) === "waiting" ? started : null);
  };

  const act = async (label: string, fn: () => Promise<Refund>, message: string) => {
    setBusy(label);
    setError(undefined);
    try {
      update(await fn(), message);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const asset = app.assets.get(refund.asset_id);
  const symbol = asset?.symbol ?? "units";
  const stage = watch ? { title: "Confirming", sub: "Simulated transfer sent" } : refundStage(refund);
  const settled = intent.data?.amount_settled;
  const full = settled !== undefined && settled === refund.amount;
  const evidenceUrl = refund.evidence ? explorerTxUrl(refund.evidence) : null;
  const rows = activity(refund);

  return (
    <div className="np-stack np-stack--lg" ref={root}>
      <LiveRegion>{announce}</LiveRegion>
      <PageHeader
        title={`Refund ${shortRef("RF", refund.id)}`}
        subtitle={
          <>
            Original payment{" "}
            <Link to={`/payments/${refund.payment_intent}`}>{shortRef("NP", refund.payment_intent)}</Link>
          </>
        }
        status={<StatusBadge data-testid="refund-status">{refundBadge(refund.status)}</StatusBadge>}
        actions={
          refund.next_action && !watch ? (
            <Button onClick={() => setReviewOpen(true)} data-testid="open-review">
              {app.mode === "test" ? "Simulate return" : "Review in wallet"}
            </Button>
          ) : undefined
        }
      />
      <StatGroup>
        <Stat
          label="Refund amount"
          value={<Money amount={refund.amount} decimals={refund.decimals} symbol={symbol} size="stat" />}
          sub={settled === undefined ? " " : full ? "Full refund" : "Partial refund"}
        />
        <Stat
          label="Return to"
          value={<span className="npf-refunds__stat-text">{truncateMiddle(refund.recipient.address, 6, 4)}</span>}
          sub={`${refund.recipient.overridden ? "Address set by an owner" : "Original payer"} · ${chainLabel(refund.recipient.chain)}`}
        />
        <Stat label="Status" value={<span className="npf-refunds__stat-text">{stage.title}</span>} sub={stage.sub} />
      </StatGroup>

      {watch && (
        <Callout tone="warning" title="Simulated transfer sent" live data-testid="simulate-confirming">
          The return is confirming. This page updates by itself when it is confirmed.
        </Callout>
      )}
      {watchTimedOut && !watch && refund.status === "requires_action" && (
        <Callout tone="warning" title="Still confirming" live data-testid="simulate-timeout">
          <p>The simulated transfer hasn't shown on this refund yet. Check again in a moment.</p>
          <p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setWatchTimedOut(false);
                setWatch(startSimulateWatch(refund, Date.now()));
              }}
              data-testid="simulate-check-again"
            >
              Check again
            </Button>
          </p>
        </Callout>
      )}
      {refund.status === "requires_action" && refund.next_action && !watch && !watchTimedOut && (
        <Callout title="Your wallet authorization is needed" data-testid="needs-signature">
          The return is prepared. Review it and approve it in the wallet that holds your settlement destination before
          the signing window closes.
        </Callout>
      )}
      {refund.status === "pending" && (
        <Callout tone="warning" title="Return in progress" live>
          Your transfer was detected. Don't create another refund — this page updates when the return is verified.
        </Callout>
      )}
      {refund.status === "succeeded" && refund.extra_amount_sent !== "0" && (
        <Callout tone="warning" title="Extra amount returned">
          A second route also settled after the payer was refunded:{" "}
          <Money amount={refund.extra_amount_sent} decimals={refund.decimals} symbol={symbol} /> extra was sent.
        </Callout>
      )}

      <ActivityTable rows={rows} />

      <div className="np-row">
        {evidenceUrl && (
          <a
            href={evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName({ variant: "secondary" })}
            data-testid="view-return-tx"
          >
            <span>View return transaction</span>
            <ExternalLinkIcon size={16} />
          </a>
        )}
        {canPrepare(refund) && (
          <Button
            variant={refund.status === "failed" ? "primary" : "secondary"}
            loading={busy === "prepare"}
            disabled={Boolean(app.gate(prepareRefund))}
            title={app.gate(prepareRefund) ?? undefined}
            onClick={() => act("prepare", () => calls.prepare(refund.id), "A new return route is being prepared.")}
            data-testid="prepare-refund"
          >
            {refund.status === "failed" ? "Try the return again" : "Prepare a new return"}
          </Button>
        )}
        {canOverrideRecipient(refund) && roleAllows(updateRefundRecipient, app.session?.role) && (
          <Button variant="ghost" onClick={() => setOverrideOpen(true)} data-testid="override-recipient">
            Change refund address
          </Button>
        )}
        {canCancel(refund) && (
          <Button
            variant="ghost"
            loading={busy === "cancel"}
            disabled={Boolean(app.gate(cancelRefund))}
            onClick={() => act("cancel", () => calls.cancel(refund.id), "Refund canceled. Nothing was sent.")}
            data-testid="cancel-refund"
          >
            Cancel refund
          </Button>
        )}
      </div>
      <ActionError error={error} />

      <Modal
        open={reviewOpen && Boolean(refund.next_action)}
        onClose={() => setReviewOpen(false)}
        dismissible={false}
        title={app.mode === "test" ? "Simulate the return" : "Review in wallet"}
        description="The refund returns to the original payer. You approve it in your wallet; NearPay never moves funds for you."
      >
        <SignRefund refund={refund} onUpdated={update} />
      </Modal>
      <OverrideRecipient
        open={overrideOpen}
        refund={refund}
        onClose={() => setOverrideOpen(false)}
        onDone={(r) => {
          setOverrideOpen(false);
          update(r, "Refund address changed. A new return route is being prepared.");
        }}
      />
    </div>
  );
}

function ActivityTable({ rows }: { rows: readonly ActivityRow[] }) {
  return (
    <Table
      caption="Refund activity"
      columns={[
        {
          key: "time",
          header: "Time",
          primary: true,
          numeric: true,
          cell: (r: ActivityRow) =>
            r.at ? (
              <time dateTime={isoOf(r.at)}>{fmtTime(r.at)}</time>
            ) : (
              <StatusBadge>{r.pendingLabel ?? "Pending"}</StatusBadge>
            ),
        },
        { key: "activity", header: "Activity", cell: (r: ActivityRow) => r.title },
        { key: "details", header: "Details", cell: (r: ActivityRow) => r.details, hideOnNarrow: true },
      ]}
      rows={rows}
      rowKey={(r) => r.id}
    />
  );
}

/** Owner-only override of the refund address (INV-7): reason required, step-up, fresh screening. */
function OverrideRecipient({
  open,
  refund,
  onClose,
  onDone,
}: {
  open: boolean;
  refund: Refund;
  onClose: () => void;
  onDone: (r: Refund) => void;
}) {
  const calls = useRefundCalls();
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [touched, setTouched] = useState(false);
  const addrErr = touched && address.trim() === "" ? "Enter the new refund address." : undefined;
  const reasonErr = touched && reason.trim() === "" ? "Say why the recorded address is replaced." : undefined;
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={false}
      title="Change refund address"
      description={`Only for owners. The new address must be on ${chainLabel(refund.recipient.chain)}; it is screened again and the change is recorded in the audit log.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep the payer's address
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setTouched(true);
              if (!address.trim() || !reason.trim()) return;
              setBusy(true);
              setError(undefined);
              try {
                onDone(await calls.overrideRecipient(refund.id, address.trim(), reason.trim()));
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
            data-testid="confirm-override"
          >
            Change address
          </Button>
        </>
      }
    >
      <div className="np-stack">
        <Callout tone="warning" title="Refunds normally return to the original payer">
          Change the address only when the payer asked for it through a channel you trust. Current address:{" "}
          <code className="npf-refunds__mono">{refund.recipient.address}</code>
        </Callout>
        <Field label="New refund address" error={addrErr} required>
          <Input
            value={address}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setAddress(e.target.value)}
            data-testid="override-address"
          />
        </Field>
        <Field label="Reason" hint="Recorded in the audit log." error={reasonErr} required>
          <Input
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            data-testid="override-reason"
          />
        </Field>
        <p className="np-text-caption np-text-secondary">You'll confirm with your passkey.</p>
        <ActionError error={error} />
      </div>
    </Modal>
  );
}
