/**
 * Mandate detail (lld/billing.md §6, §7.1, §14; spec 0.4.0 `getMandate`): status and link status (with
 * the unlinked reason explained), balance, periods left, next collection, terms, the collection history
 * with on-chain evidence (NEAR transaction of each `collect`, INV-2), keeper failures and what happens
 * next, cancel/refund details, merchant cancel (`CancelMandateDialog`) and, in test mode, the simulated
 * customer's actions (`simulateMandatePayerAction` on the sandbox vault).
 */
import type { Invoice } from "@nearpay/spec";
import { getMandate, type Mandate, prepareMandateCancel, simulateMandatePayerAction } from "@nearpay/spec";
import { Callout, KeyValueList, LiveRegion, Table, useToast } from "@nearpay-internal/ui";
import { useCallback, useEffect, useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatDate, formatWhen } from "../../lib/format";
import { roleAllows } from "../../lib/permissions";
import { ErrorState, LoadingState, Page, Section, StatRow } from "../../ui/page";
import { Button, ErrorNote } from "../../ui/ui";
import type { MandateSimulation } from "./types";
import "../billing/billing.css";
import { invoiceTitle, useCustomerNames } from "../billing/shared";
import { useCollectionInvoices, useMandate } from "./api";
import { CancelMandateDialog } from "./CancelMandate";
import {
  bpsText,
  type CollectionRow,
  collectionRows,
  expectedShare,
  isOnchainActive,
  periodText,
  unlinkedReasonText,
} from "./logic";
import { MandateStatus, NearAccount, NearTx, useToken } from "./parts";
import "./mandates.css";

export function MandateDetail({ id }: { id: string }) {
  const m = useMandate(id);
  if (m.loading && !m.data) return <LoadingState what="Loading mandate" stats={3} />;
  if (m.error || !m.data) return <ErrorState title="Mandate" error={m.error} onRetry={m.reload} />;
  return <MandateView key={m.data.id} initial={m.data} />;
}

/** Consecutive `collect_failed` outcomes before the invoice falls back to email (billing §7.1). */
const MAX_COLLECT_FAILURES = 5;

function MandateView({ initial }: { initial: Mandate }) {
  const app = useApp();
  const [m, setM] = useState(initial);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const token = useToken();
  const customers = useCustomerNames([m.customer]);
  const inv = useCollectionInvoices(m.subscription, m.sequence);
  const rows = collectionRows(m, inv.data?.invoices ?? []);
  const amt = (v: string) => token(m.asset_id, v);
  const active = isOnchainActive(m);
  const canCancel = active && roleAllows(prepareMandateCancel, app.session?.role);
  const customer = customers.get(m.customer) ?? "…";
  const [follow, setFollow] = useState(false);
  const onChanged = useCallback((next: Mandate) => {
    setM((cur) => (next.sequence >= cur.sequence ? next : cur));
  }, []);
  // after a merchant cancel was sent, follow the mirror until the vault's `canceled` event arrives
  // (every 5 s, at most 2 min); the page shows "canceled" only from the API (INV-2)
  useEffect(() => {
    if (!follow) return;
    let n = 0;
    const t = setInterval(async () => {
      n++;
      try {
        const next = (await app.api.call(getMandate, { params: { id: initial.id } })) as Mandate;
        onChanged(next);
        if (next.status === "canceled") {
          setAnnounce("Mandate canceled. The remaining balance went back to the customer.");
          setFollow(false);
        }
      } catch {
        // keep the last known state; try again on the next tick
      }
      if (n >= 24) setFollow(false);
    }, 5000);
    return () => clearInterval(t);
  }, [follow, app.api, initial.id, onChanged]);

  const fee = BigInt(m.amount_per_period) - expectedShare(m.amount_per_period, m.fee_bps);
  return (
    <Page
      title={customer}
      subtitle={`Auto-debit mandate · funded ${formatDate(m.created)}`}
      status={<MandateStatus mandate={m} />}
      back={{ label: "Auto-debit", to: "/billing/mandates" }}
      actions={
        canCancel ? (
          <Button variant="secondary" onClick={() => setCancelOpen(true)} data-testid="cancel-mandate-open">
            Cancel mandate
          </Button>
        ) : undefined
      }
      data-testid="mandate-detail"
    >
      <LiveRegion>{announce}</LiveRegion>
      <StatRow
        items={[
          {
            label: "Balance",
            value: amt(m.balance),
            sub: `${m.funded_periods} period${m.funded_periods === 1 ? "" : "s"} left at ${amt(m.amount_per_period)}`,
          },
          {
            label: "Next collection",
            value: m.next_collect_at && m.collecting ? formatDate(m.next_collect_at) : "—",
            sub: m.collecting
              ? `Every ${periodText(m.period_secs)}`
              : active
                ? "NearPay doesn't collect from this mandate"
                : "No further collections",
          },
          {
            label: "Collected",
            value: `${m.collected_periods} period${m.collected_periods === 1 ? "" : "s"}`,
            sub: m.max_periods ? `of at most ${m.max_periods}` : "Until canceled",
          },
        ]}
      />

      <MandateNotices m={m} amt={amt} />

      <Section title="Collections" data-testid="mandate-collections">
        {inv.error ? <ErrorNote error={inv.error} onRetry={inv.reload} /> : null}
        <Table<CollectionRow>
          caption="Collections from this mandate"
          loading={inv.loading && !inv.data}
          rows={rows}
          rowKey={(r) => r.key}
          empty={
            m.status === "canceled" || m.link_status === "unlinked"
              ? "Nothing was collected from this mandate."
              : m.next_collect_at
                ? `The first collection is due ${formatDate(m.next_collect_at)}.`
                : "No collections yet."
          }
          columns={[
            { key: "p", header: "Period", primary: true, cell: (r) => `Period ${r.period}` },
            {
              key: "i",
              header: "Invoice",
              cell: (r) =>
                r.invoice ? (
                  <Link to={`/billing/invoices/${r.invoice}`}>{invoiceLabel(r.invoice, inv.data?.invoices)}</Link>
                ) : (
                  "—"
                ),
            },
            {
              key: "s",
              header: "You received",
              numeric: true,
              cell: (r) => (
                <span>
                  {amt(r.merchant_share)}
                  {r.short ? (
                    <span className="np-text-caption npf-mandates__warn npf-mandates__sub">
                      Short — balance invoiced
                    </span>
                  ) : null}
                </span>
              ),
            },
            { key: "f", header: "NearPay fee", numeric: true, hideOnNarrow: true, cell: (r) => amt(r.fee) },
            {
              key: "d",
              header: "Collected",
              hideOnNarrow: true,
              cell: (r) => (r.collected_at ? formatWhen(r.collected_at) : "—"),
            },
            {
              key: "t",
              header: "Evidence",
              cell: (r) => <NearTx hash={r.tx_hash} livemode={m.livemode} />,
            },
          ]}
        />
        {inv.data?.capped ? (
          <p className="np-text-caption np-text-secondary">Showing collections from the latest 100 paid invoices.</p>
        ) : null}
      </Section>

      <div className="npf-billing__columns">
        <Section title="Terms" data-testid="mandate-terms">
          <KeyValueList
            items={[
              { label: "Per period", value: `${amt(m.amount_per_period)} every ${periodText(m.period_secs)}` },
              { label: "First period due", value: formatWhen(m.start_at) },
              { label: "Maximum periods", value: m.max_periods ? String(m.max_periods) : "Until canceled" },
              {
                label: "NearPay fee",
                value: `${bpsText(m.fee_bps)} · ${amt(fee.toString())} per period`,
              },
              {
                label: "You receive per period",
                value: amt(expectedShare(m.amount_per_period, m.fee_bps).toString()),
                total: true,
              },
            ]}
          />
        </Section>
        <Section title="Accounts" data-testid="mandate-accounts">
          <KeyValueList
            items={[
              { label: "Customer pays from", value: <NearAccount account={m.payer} livemode={m.livemode} /> },
              {
                label: "Paid to",
                value: (
                  <span className="npf-mandates__pair">
                    <NearAccount account={m.merchant_receiver} livemode={m.livemode} />
                    <span className="np-text-caption np-text-secondary">
                      {m.receiver_kind === "intents_account" ? "NEAR Intents account" : "NEAR account"}
                      {m.settlement_destination ? (
                        <>
                          {" · "}
                          <Link to="/settlement">Settlement destination</Link>
                        </>
                      ) : null}
                    </span>
                  </span>
                ),
              },
              {
                label: "Vault",
                value: (
                  <span className="npf-mandates__pair">
                    <span className="npf-mandates__account">{m.vault_contract}</span>
                    <span className="np-text-caption np-text-secondary">
                      Mandate #{m.onchain_id}
                      {m.livemode ? "" : " · sandbox vault (test mode)"}
                    </span>
                  </span>
                ),
              },
              { label: "Token", value: <span className="npf-mandates__account">{m.token}</span> },
            ]}
          />
        </Section>
      </div>

      <Section title="Details">
        <KeyValueList
          items={[
            { label: "Customer", value: <Link to={`/customers/${m.customer}`}>{customer}</Link> },
            {
              label: "Subscription",
              value: <Link to={`/billing/subscriptions/${m.subscription}`}>{m.subscription}</Link>,
            },
            { label: "Collected by NearPay", value: m.collecting ? "Yes" : "No" },
            ...(m.withdrawn !== "0" ? [{ label: "Withdrawn by the customer", value: amt(m.withdrawn) }] : []),
            { label: "Mandate ID", value: <code className="npf-billing__mono">{m.id}</code> },
          ]}
        />
      </Section>

      {!m.livemode ? (
        <TestHelpers
          m={m}
          onDone={(msg) => {
            setAnnounce(msg);
          }}
        />
      ) : null}

      {cancelOpen ? (
        <CancelMandateDialog mandate={m} onClose={() => setCancelOpen(false)} onSent={() => setFollow(true)} />
      ) : null}
    </Page>
  );
}

function invoiceLabel(id: string, invoices: readonly Invoice[] | undefined): string {
  const i = invoices?.find((x) => x.id === id);
  return invoiceTitle(i ?? { id: id as Invoice["id"], number: null });
}

function MandateNotices({ m, amt }: { m: Mandate; amt(v: string): string }) {
  const notices = [];
  if (m.link_status === "unlinked")
    notices.push(
      <Callout key="unlinked" tone="danger" title="Not linked to the subscription" data-testid="unlinked-notice">
        {unlinkedReasonText(m.unlinked_reason)} NearPay never collects from an unlinked mandate and has asked the
        customer to cancel it; cancelling returns their whole balance.
      </Callout>,
    );
  if (m.link_status === "linked" && !m.collecting && isOnchainActive(m))
    notices.push(
      <Callout key="released" tone="warning" title="No longer collected">
        The subscription ended or stopped using auto-debit, so NearPay released this mandate and emailed the customer
        how to cancel it and get the {amt(m.balance)} balance back.
      </Callout>,
    );
  if (m.status === "insufficient" && m.collecting)
    notices.push(
      <Callout key="low" tone="warning" title="Balance below one period" data-testid="insufficient-notice">
        The next collection needs {amt(m.amount_per_period)}. NearPay emailed the customer to top up; if the balance is
        still short when it's due, that invoice is emailed for payment instead.
      </Callout>,
    );
  if (m.collect_failures > 0)
    notices.push(
      <Callout key="keeper" tone="warning" title="Collections are failing" data-testid="keeper-notice">
        The last {m.collect_failures === 1 ? "collection" : `${m.collect_failures} collections`} delivered nothing to
        your receiving account (the customer was not charged). NearPay retries each minute; after {MAX_COLLECT_FAILURES}{" "}
        failures in a row (or 24 hours) the invoice is emailed instead and NearPay opens a case to check your
        destination ({m.collect_failures} of {MAX_COLLECT_FAILURES} so far).
      </Callout>,
    );
  if (m.last_collection?.short)
    notices.push(
      <Callout key="short" tone="warning" title={`Period ${m.last_collection.period} arrived short`}>
        You received {amt(m.last_collection.merchant_share)} instead of the full share. The invoice isn't marked paid;
        NearPay emails the customer a balance invoice for the difference and opened a case.
      </Callout>,
    );
  if (m.last_collection && m.last_collection.fee === "0" && m.fee_bps > 0)
    notices.push(
      <Callout key="fee" tone="info" title="No fee was taken for the last period">
        The NearPay fee leg didn't go through, so the fee stayed with the customer. You received your full share.
      </Callout>,
    );
  if (m.canceled)
    notices.push(
      <Callout key="canceled" tone="neutral" title={`Canceled ${formatWhen(m.canceled.canceled_at)}`}>
        By {m.canceled.by_role === "merchant_receiver" ? "your receiving account" : "the customer"} (
        <span className="npf-mandates__account">{m.canceled.by}</span>).{" "}
        {m.canceled.refunded === "0"
          ? "The refund to the customer failed on chain; they can withdraw the balance from their wallet."
          : `${amt(m.canceled.refunded)} went back to the customer.`}
      </Callout>,
    );
  if (m.status === "exhausted")
    notices.push(
      <Callout key="exhausted" tone="neutral" title="All periods collected">
        This mandate reached its maximum of {m.max_periods} periods. Any remaining balance is the customer's to
        withdraw.
      </Callout>,
    );
  return notices.length ? <div className="np-stack">{notices}</div> : null;
}

/** Test mode: act as the simulated customer on the sandbox vault (results follow from the forwarded events). */
function TestHelpers({ m, onDone }: { m: Mandate; onDone(msg: string): void }) {
  const app = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<MandateSimulation>();
  const allowed = roleAllows(simulateMandatePayerAction, app.session?.role);
  const run = async (action: "top_up" | "cancel" | "withdraw") => {
    setBusy(action);
    setError(undefined);
    try {
      const r = (await app.api.call(simulateMandatePayerAction, {
        params: { id: m.id },
        body: action === "top_up" ? { action, periods: 1 } : { action },
      })) as MandateSimulation;
      setResult(r);
      const msg = r.accepted
        ? "The sandbox vault accepted it. The mandate updates in a few seconds; reload to see it."
        : `The sandbox vault refused it: ${r.rejection ?? "no reason given"}.`;
      onDone(msg);
      toast.show({ tone: r.accepted ? "success" : "warning", title: msg });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };
  const active = isOnchainActive(m);
  return (
    <Section
      title="Test helpers"
      aside="Test mode · acts as the customer on the sandbox vault"
      data-testid="mandate-test-helpers"
    >
      <div className="np-row npf-mandates__helpers">
        <Button
          variant="secondary"
          size="sm"
          busy={busy === "top_up"}
          disabled={!allowed || !active || !!busy}
          onClick={() => void run("top_up")}
        >
          Top up one period
        </Button>
        <Button
          variant="secondary"
          size="sm"
          busy={busy === "cancel"}
          disabled={!allowed || !active || !!busy}
          onClick={() => void run("cancel")}
        >
          Cancel as customer
        </Button>
        <Button
          variant="secondary"
          size="sm"
          busy={busy === "withdraw"}
          disabled={!allowed || active || m.balance === "0" || !!busy}
          onClick={() => void run("withdraw")}
        >
          Withdraw balance
        </Button>
      </div>
      {result ? (
        <p className="np-text-small np-text-secondary" data-testid="simulation-result">
          {result.accepted ? "Accepted" : `Refused: ${result.rejection ?? "unknown"}`} · sandbox transaction{" "}
          <NearTx hash={result.tx_hash} livemode={false} />
        </p>
      ) : null}
      {!allowed ? (
        <p className="np-text-caption np-text-secondary">Owners, admins and developers can use test helpers.</p>
      ) : null}
      <ErrorNote error={error} />
    </Section>
  );
}
