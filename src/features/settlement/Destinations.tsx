/**
 * Settlement destinations (Figma "Settlement"): where payments settle, with status (cool-off with the
 * activation time, pending approval with the two-approver progress from spec 0.2.0 `approval`), and the
 * actions sign / approve / reject / make default / disable. Approval follows the server's rule
 * (`approveSettlementDestination`, `403 approver_conflict`); the UI never decides it.
 */
import {
  approveSettlementDestination,
  disableSettlementDestination,
  listMembers,
  listSettlementDestinations,
  type SettlementDestination,
  setDefaultSettlementDestination,
} from "@nearpay/spec";
import { buttonClassName, Callout, StatusBadge, Table, useToast, WalletIcon } from "@nearpay-internal/ui";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { networkName } from "../../lib/chains";
import { formatDate, relative, shorten } from "../../lib/format";
import { useAsync, useMutation, useNow } from "../../lib/hooks";
import { assetLabel, formatFiat } from "../../lib/money";
import { roleAllows } from "../../lib/permissions";
import { statusOf } from "../../lib/status";
import { ConfirmDialog, Empty, ErrorState, LoadingState, Page, useConfirm } from "../../ui/page";
import { Button, ErrorNote, Mono } from "../../ui/ui";
import { TENURE_COPY } from "../team/approval-copy";

type Dest = SettlementDestination;

function clock(unix: number): string {
  const d = new Date(unix * 1000);
  return `${formatDate(unix).replace(/ \d{4}$/, "")} at ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "1 of 2 approvals" for a destination awaiting approval (spec 0.2.0; absent on Stage 1 servers). */
export function approvalText(d: Pick<Dest, "approval">): string | null {
  const a = d.approval;
  if (!a) return null;
  return `${a.approved_by.length} of ${a.required} approval${a.required === 1 ? "" : "s"}`;
}

function DestinationStatus({ d, now }: { d: Dest; now: number }) {
  // spec 0.2.1: pending destinations not approved within 7 days are disabled with reason `expired`
  const expired = d.status === "disabled" && d.disabled_reason === "expired";
  const s = expired ? { label: "Expired", tone: "danger" as const } : statusOf("destination", d.status);
  return (
    <div className="dash-cell-stack">
      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      {expired ? (
        <span className="np-text-caption np-text-secondary" data-testid="expired">
          Not approved within 7 days. Add it again.
        </span>
      ) : null}
      {d.status === "cooling_off" && d.active_at ? (
        <span className="np-text-caption np-text-secondary" data-testid="cooloff">
          Activates {relative(d.active_at, now)}
        </span>
      ) : null}
      {d.status === "pending_approval" && approvalText(d) ? (
        <span className="np-text-caption np-text-secondary" data-testid="approval">
          {approvalText(d)}
        </span>
      ) : null}
      {d.status === "pending_approval" ? (
        <span className="np-text-caption np-text-secondary" data-testid="approval-expiry">
          Expires {formatDate(d.created + 7 * 86_400)} if not approved
        </span>
      ) : null}
    </div>
  );
}

export function Destinations() {
  const app = useApp();
  const toast = useToast();
  const now = useNow(30_000);
  const list = useAsync(() => app.api.call(listSettlementDestinations, { query: { limit: 100 } }), [app.api, app.mode]);
  // who added each destination (spec 0.2.1 `created_by`): names from the team list when the role may read it
  const canSeeTeam = roleAllows(listMembers, app.session?.role);
  const team = useAsync(
    async () => (canSeeTeam ? (await app.api.call(listMembers, { query: { limit: 100 } })).data : []),
    [app.api, canSeeTeam],
  );
  const memberEmail = (id: string) =>
    id === app.session?.user.id ? "you" : (team.data?.find((m) => m.user.id === id)?.user.email ?? "a team member");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const disabling = useConfirm<Dest>();
  const rejecting = useConfirm<Dest>();
  const me = app.session?.user.id;

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
      list.reload();
      app.refreshAccount();
      if (done) toast.show({ tone: "success", title: done });
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(undefined);
    }
  };
  const disable = useMutation(async (d: Dest) => {
    await app.api.call(disableSettlementDestination, { params: { id: d.id }, body: {} });
    list.reload();
    app.refreshAccount();
    disabling.close();
    toast.show({ tone: "success", title: `${d.label} disabled`, body: "Existing payments keep their destination." });
  });
  const reject = useMutation(async (d: Dest) => {
    await app.api.call(approveSettlementDestination, { params: { id: d.id }, body: { decision: "reject" } });
    list.reload();
    rejecting.close();
    toast.show({ tone: "success", title: `${d.label} rejected`, body: "The destination is disabled." });
  });

  if (list.loading && !list.data) return <LoadingState what="Loading settlement destinations" />;
  if (!list.data) return <ErrorState title="Settlement" error={list.error} onRetry={list.reload} />;
  const rows = list.data.data;
  const coolingOff = rows.filter((d) => d.status === "cooling_off" && d.active_at);

  return (
    <Page
      title="Settlement"
      subtitle="Choose the currency and wallet where you receive payments."
      actions={
        <Link to="/settlement/new" className={buttonClassName({ variant: "primary" })}>
          <span>Add destination</span>
        </Link>
      }
    >
      <Callout tone="info" title="Your funds go directly to your wallet">
        Changing a destination affects future payments only. Existing payments retain their original destination.
        NearPay never holds funds.
      </Callout>
      <ErrorNote error={error} />
      {rows.length === 0 ? (
        <Empty
          icon={<WalletIcon size={32} />}
          title={`No ${app.mode} destinations yet`}
          action={
            <Link to="/settlement/new" className={buttonClassName({ variant: "secondary" })}>
              <span>Add your first destination</span>
            </Link>
          }
          footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
        >
          {app.mode === "test"
            ? "Test destinations are active immediately and receive sandbox settlements only."
            : "Live destinations are verified with a wallet signature and become active after a 24-hour safety window."}
        </Empty>
      ) : (
        <div data-testid="destinations-table">
          <Table
            caption="Settlement destinations"
            rows={rows}
            rowKey={(d) => d.id}
            columns={[
              {
                key: "dest",
                header: "Destination",
                primary: true,
                cell: (d) => (
                  <span className="dash-cell-stack" data-testid={`destination-${d.id}`}>
                    <span>
                      {d.label}
                      {d.is_default ? " · Default" : ""}
                    </span>
                    <span className="np-text-caption np-text-secondary">
                      {d.created_by ? `Added by ${memberEmail(d.created_by)} · ` : ""}
                      {d.type === "intents_account" ? "NEAR Intents account" : "Wallet address"}
                      {d.verification === "unverified" ? " · Unverified (capped)" : ""}
                      {d.min_payment_amount ? ` · Min ${formatFiat(d.min_payment_amount.amount, "usd")}` : ""}
                    </span>
                  </span>
                ),
              },
              {
                key: "asset",
                header: "Receive in",
                cell: (d) => `${assetLabel(d.asset_id, app.assets)} · ${networkName(d.chain)}`,
              },
              {
                key: "wallet",
                header: "Wallet",
                hideOnNarrow: true,
                cell: (d) => <Mono title={d.address}>{shorten(d.address, 6)}</Mono>,
              },
              {
                key: "fp",
                header: "Fingerprint",
                hideOnNarrow: true,
                cell: (d) => <Mono>{d.fingerprint}</Mono>,
              },
              { key: "status", header: "Status", cell: (d) => <DestinationStatus d={d} now={now} /> },
              {
                key: "actions",
                header: <span className="np-sr-only">Actions</span>,
                align: "end",
                cell: (d) => {
                  const approved = Boolean(me && d.approval?.approved_by.includes(me));
                  return (
                    <div className="dash-row-actions">
                      {d.status === "pending_verification" && (
                        <Link
                          to={`/settlement/${d.id}/attest`}
                          className={buttonClassName({ variant: "secondary", size: "sm" })}
                        >
                          <span>Sign</span>
                        </Link>
                      )}
                      {d.status === "pending_approval" && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            busy={busy === `approve-${d.id}`}
                            blocked={
                              approved
                                ? "You already approved. Another owner or admin must approve."
                                : app.gate(approveSettlementDestination)
                            }
                            onClick={() =>
                              void act(
                                `approve-${d.id}`,
                                () =>
                                  app.api.call(approveSettlementDestination, {
                                    params: { id: d.id },
                                    body: { decision: "approve" },
                                  }),
                                `${d.label} approved`,
                              )
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            blocked={app.gate(approveSettlementDestination)}
                            onClick={() => {
                              reject.reset();
                              rejecting.open(d);
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {d.status === "active" && !d.is_default && (
                        <Button
                          variant="secondary"
                          size="sm"
                          busy={busy === `default-${d.id}`}
                          blocked={app.gate(setDefaultSettlementDestination)}
                          onClick={() =>
                            void act(
                              `default-${d.id}`,
                              () =>
                                app.api.call(setDefaultSettlementDestination, {
                                  params: { id: d.id },
                                  body: { scope: "asset" },
                                }),
                              `${d.label} is now the default`,
                            )
                          }
                        >
                          Make default
                        </Button>
                      )}
                      {d.status !== "disabled" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          blocked={app.gate(disableSettlementDestination)}
                          onClick={() => {
                            disable.reset();
                            disabling.open(d);
                          }}
                        >
                          Disable
                        </Button>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      )}
      {(list.data?.data ?? []).some((d) => d.status === "pending_approval") ? (
        <Callout title="How approvals count" data-testid="approval-rules">
          {TENURE_COPY} A destination that isn't fully approved within 7 days of being added expires.
        </Callout>
      ) : null}
      {coolingOff.map((d) => (
        <p key={d.id} className="np-text-caption np-text-secondary">
          {d.label} activates {clock(d.active_at as number)} ·{" "}
          {relative(d.active_at as number, now).replace(/^in /, "")} remaining. All owners were notified.
        </p>
      ))}
      <ConfirmDialog
        open={Boolean(disabling.target)}
        title={`Disable ${disabling.target?.label ?? "destination"}?`}
        description="New payments can't settle here any more. Existing payments keep their destination."
        confirmLabel="Disable destination"
        busy={disable.busy}
        error={disable.error}
        onClose={disabling.close}
        onConfirm={() => disabling.target && void disable.run(disabling.target)}
      />
      <ConfirmDialog
        open={Boolean(rejecting.target)}
        title={`Reject ${rejecting.target?.label ?? "destination"}?`}
        description="Rejecting disables the destination. Whoever added it can add it again."
        confirmLabel="Reject destination"
        busy={reject.busy}
        error={reject.error}
        onClose={rejecting.close}
        onConfirm={() => rejecting.target && void reject.run(rejecting.target)}
      />
    </Page>
  );
}
