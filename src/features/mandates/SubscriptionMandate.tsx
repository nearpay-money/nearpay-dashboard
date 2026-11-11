/**
 * Auto-debit panel on the subscription page (lld/billing.md §14; spec 0.4.0 `listMandates`,
 * `prepareMandate`, `simulateMandateFunding`): the linked mandate (status, balance, periods left, next
 * collection, last collection with its evidence, keeper failures), unlinked mandates with the reason and
 * what happens next, and — while no mandate is linked — how the customer sets one up: the hosted invoice
 * page of the open invoice (it offers "Set up auto-debit", billing §14 d8) and the prepared funding terms
 * (`prepareMandate`, display-checked by `checkFundingTx`) to share. The amount-locked notice explains why
 * per-period changes are refused while a linked mandate is active (§14 d6). Test mode can play the
 * customer (`simulateMandateFunding` on the sandbox vault).
 */

import { Callout, CopyField, KeyValueList, Select, useToast } from "@nearpay-internal/ui";
import type { Invoice, Subscription } from "@nearpay-money/spec";
import { type Mandate, prepareMandate, simulateMandateFunding } from "@nearpay-money/spec";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatDate, formatWhen } from "../../lib/format";
import { roleAllows } from "../../lib/permissions";
import { Section } from "../../ui/page";
import { Button, ErrorNote, Field, Modal } from "../../ui/ui";
import { useSubscriptionMandates } from "./api";
import {
  checkFundingTx,
  fundingInstructionsText,
  gasText,
  isOnchainActive,
  periodText,
  pickLinked,
  startAtSeconds,
  tokenAmount,
  unlinkedReasonText,
  yoctoText,
} from "./logic";
import { MandateStatus, NearAccount, NearTx, useToken } from "./parts";
import type { MandateFundingInstructions, MandateSimulation } from "./types";
import "./mandates.css";

export function SubscriptionMandate({
  sub,
  latest,
  merchant,
}: {
  sub: Subscription;
  latest: Invoice | null | undefined;
  merchant: string;
}) {
  const list = useSubscriptionMandates(sub.id, sub.sequence);
  const token = useToken();
  const [funding, setFunding] = useState(false);
  const autoDebit = (sub.collection_method as string) === "auto_debit";
  const mandates = list.data ?? [];
  if (!autoDebit && !list.loading && mandates.length === 0 && !list.error) return null;
  const linked = pickLinked(sub, mandates);
  const unlinked = mandates.filter((m) => m.link_status === "unlinked" && isOnchainActive(m));
  const ended = sub.status === "canceled";
  const amt = (m: Mandate, v: string) => token(m.asset_id, v);

  return (
    <Section
      title="Auto-debit"
      aside={autoDebit ? "Collected from the customer's mandate" : "Not used for renewals"}
      data-testid="subscription-mandate"
    >
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <p className="np-text-secondary">Loading mandates…</p> : null}

      {linked ? (
        <div className="np-stack">
          <Callout tone="info" title="Amount locked while this mandate is active" data-testid="amount-locked">
            The customer authorised {amt(linked, linked.amount_per_period)} every {periodText(linked.period_secs)}.
            Changes to items or tax rates that change the per-period total are refused until the mandate ends. To change
            the price, switch to emailed invoices (this releases the mandate) and have the customer fund a new one.
          </Callout>
          <KeyValueList
            items={[
              {
                label: "Mandate",
                value: (
                  <span className="npf-mandates__inline">
                    <MandateStatus mandate={linked} />
                    <Link to={`/billing/mandates/${linked.id}`} data-testid="linked-mandate-link">
                      View mandate
                    </Link>
                  </span>
                ),
              },
              {
                label: "Balance",
                value: `${amt(linked, linked.balance)} · ${linked.funded_periods} period${linked.funded_periods === 1 ? "" : "s"} left`,
              },
              {
                label: "Next collection",
                value: linked.next_collect_at && linked.collecting ? formatWhen(linked.next_collect_at) : "—",
              },
              { label: "Customer pays from", value: <NearAccount account={linked.payer} livemode={linked.livemode} /> },
              ...(linked.last_collection
                ? [
                    {
                      label: "Last collection",
                      value: (
                        <span className="npf-mandates__inline">
                          Period {linked.last_collection.period} · {amt(linked, linked.last_collection.merchant_share)}{" "}
                          · <NearTx hash={linked.last_collection.tx_hash} livemode={linked.livemode} label="evidence" />
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {linked.status === "insufficient" ? (
            <Callout tone="warning" title="Balance below one period">
              NearPay emailed the customer to top up. If it's still short when due, that renewal is emailed as an
              invoice instead.
            </Callout>
          ) : null}
          {linked.collect_failures > 0 ? (
            <Callout tone="warning" title="Collections are failing" data-testid="panel-keeper-notice">
              {linked.collect_failures} failed in a row (the customer wasn't charged). After 5, the invoice is emailed
              and NearPay opens a case. <Link to={`/billing/mandates/${linked.id}`}>Details</Link>
            </Callout>
          ) : null}
        </div>
      ) : autoDebit && !ended && !list.loading ? (
        <SetupState sub={sub} latest={latest} onPrepare={() => setFunding(true)} reload={list.reload} />
      ) : null}

      {unlinked.map((m) => (
        <Callout key={m.id} tone="danger" title="A mandate isn't linked" data-testid="panel-unlinked">
          {unlinkedReasonText(m.unlinked_reason)} It holds {amt(m, m.balance)} from{" "}
          <span className="npf-mandates__account">{m.payer}</span>; NearPay never collects from it and asked the
          customer to cancel it. <Link to={`/billing/mandates/${m.id}`}>View mandate</Link>
        </Callout>
      ))}

      {mandates.length > 1 || (mandates.length === 1 && !linked && unlinked.length === 0) ? (
        <p className="np-text-small np-text-secondary">
          {mandates.length} mandate{mandates.length === 1 ? "" : "s"} for this subscription ·{" "}
          <Link to={`/billing/mandates?subscription=${sub.id}`}>See all</Link>
        </p>
      ) : null}

      {funding ? (
        <FundingDialog sub={sub} latest={latest} merchant={merchant} onClose={() => setFunding(false)} />
      ) : null}
    </Section>
  );
}

/** No linked mandate yet: where the customer sets it up, and the test-mode shortcut. */
function SetupState({
  sub,
  latest,
  onPrepare,
  reload,
}: {
  sub: Subscription;
  latest: Invoice | null | undefined;
  onPrepare(): void;
  reload(): void;
}) {
  const app = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [sim, setSim] = useState<MandateSimulation>();
  const canPrepare = roleAllows(prepareMandate, app.session?.role);
  const canSimulate = roleAllows(simulateMandateFunding, app.session?.role);
  const openInvoice = latest && latest.status === "open" && latest.hosted_invoice_url ? latest : null;
  const simulate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = (await app.api.call(simulateMandateFunding, { body: { subscription: sub.id } })) as MandateSimulation;
      setSim(r);
      toast.show({
        tone: r.accepted ? "success" : "warning",
        title: r.accepted ? "The simulated customer funded a mandate." : "The sandbox vault refused the funding.",
      });
      if (r.accepted) reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="npf-mandates__setup" data-testid="mandate-setup">
      <Callout tone="warning" title="Waiting for the customer to fund a mandate">
        Until they do, renewals are emailed as invoices. The customer funds the mandate from their own NEAR wallet and
        can cancel it at any time.
      </Callout>
      {openInvoice?.hosted_invoice_url ? (
        <CopyField
          label="Customer setup link"
          value={openInvoice.hosted_invoice_url}
          defaultRevealed
          data-testid="setup-link"
        />
      ) : (
        <p className="np-text-small np-text-secondary">
          There's no open invoice to share right now. The next renewal invoice's page offers "Set up auto-debit", or
          share the prepared funding details.
        </p>
      )}
      {openInvoice ? (
        <p className="np-text-caption np-text-secondary">
          The page of invoice {openInvoice.number ?? openInvoice.id} offers "Set up auto-debit": the customer funds the
          mandate there, and its first collection pays this invoice.
        </p>
      ) : null}
      <div className="np-row npf-mandates__helpers">
        <Button variant="secondary" onClick={onPrepare} disabled={!canPrepare} data-testid="prepare-funding">
          Preview funding details
        </Button>
        {!sub.livemode ? (
          <Button
            variant="secondary"
            busy={busy}
            disabled={!canSimulate}
            onClick={() => void simulate()}
            data-testid="simulate-funding"
          >
            Simulate customer funding
          </Button>
        ) : null}
      </div>
      {sim ? (
        <p className="np-text-small np-text-secondary" data-testid="simulation-result">
          {sim.accepted ? "Accepted" : `Refused: ${sim.rejection ?? "unknown"}`} · sandbox transaction{" "}
          <NearTx hash={sim.tx_hash} livemode={false} />
        </p>
      ) : null}
      <ErrorNote error={error} />
    </div>
  );
}

/** USDC/USDT on NEAR for USD subscriptions (billing §14 d2), from the asset registry. */
function useUsdTokens() {
  const app = useApp();
  return [...app.assets.entries()]
    .filter(
      ([id, a]) =>
        id.startsWith("nep141:") && a.chain === "near:mainnet" && (a.symbol === "USDC" || a.symbol === "USDT"),
    )
    .map(([id, a]) => ({ value: id.slice("nep141:".length), label: a.symbol }));
}

const PERIOD_OPTIONS = [1, 3, 6, 12, 24, 36].map((n) => ({
  value: String(n),
  label: `${n} period${n === 1 ? "" : "s"}`,
}));

/** `prepareMandate`: the exact terms and transactions the customer signs, to review and share. */
function FundingDialog({
  sub,
  latest,
  merchant,
  onClose,
}: {
  sub: Subscription;
  latest: Invoice | null | undefined;
  merchant: string;
  onClose(): void;
}) {
  const app = useApp();
  const tokens = useUsdTokens();
  const usd = sub.currency === "usd";
  const [periods, setPeriods] = useState("3");
  const [tok, setTok] = useState(usd ? (tokens[0]?.value ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [ix, setIx] = useState<MandateFundingInstructions>();
  const asset = ix ? app.assets.get(ix.asset_id) : undefined;
  const amt = (v: string) => tokenAmount(v, asset?.symbol, asset?.decimals);

  const prepare = async () => {
    setBusy(true);
    setError(undefined);
    setIx(undefined);
    try {
      const r = (await app.api.call(prepareMandate, {
        body: { subscription: sub.id, periods: Number(periods), ...(usd && tok ? { token: tok } : {}) },
      })) as MandateFundingInstructions;
      const problem = checkFundingTx(r);
      if (problem) throw new Error(`${problem} Don't share these details; refresh and try again.`);
      setIx(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const start = ix ? startAtSeconds(ix.start_at) : null;
  const invoiceUrl = latest?.status === "open" ? latest.hosted_invoice_url : null;
  return (
    <Modal
      title="Auto-debit funding details"
      description="What the customer signs from their own NEAR wallet. Nothing is created until they send it."
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button busy={busy} onClick={() => void prepare()} data-testid="prepare-funding-submit">
            {ix ? "Prepare again" : "Prepare"}
          </Button>
        </>
      }
    >
      <div className="np-stack" data-testid="funding-dialog">
        <div className="npf-mandates__form">
          <Field label="Fund up front" hint="Periods the first deposit covers. The customer can top up later.">
            {(id) => (
              <Select id={id} value={periods} options={PERIOD_OPTIONS} onChange={(e) => setPeriods(e.target.value)} />
            )}
          </Field>
          {usd && tokens.length > 1 ? (
            <Field label="Token" hint="USD prices are paid at par.">
              {(id) => <Select id={id} value={tok} options={tokens} onChange={(e) => setTok(e.target.value)} />}
            </Field>
          ) : null}
        </div>
        <ErrorNote error={error} />
        {ix ? (
          <>
            <KeyValueList
              items={[
                { label: "Per period", value: `${amt(ix.amount_per_period)} every ${periodText(ix.period_secs)}` },
                { label: "First deposit", value: `${amt(ix.amount)} (${ix.periods} periods)` },
                {
                  label: "First collection",
                  value: start ? formatDate(start) : "As soon as it's funded (pays the open invoice)",
                },
                { label: "Paid to", value: <span className="npf-mandates__account">{ix.merchant_receiver}</span> },
                { label: "Vault", value: <span className="npf-mandates__account">{ix.vault_contract}</span> },
              ]}
            />
            <Callout tone="info" title="The customer signs from their own account">
              {ix.payer_notice}
            </Callout>
            <ol className="npf-mandates__tx" aria-label="Transactions the customer signs">
              {ix.transactions.map((t, i) =>
                t.actions.map((a) => (
                  <li key={`${t.receiver_id}:${a.method_name}`}>
                    <span className="np-text-small">
                      <strong>
                        {i + 1}. {a.method_name}
                      </strong>{" "}
                      on <span className="npf-mandates__account">{t.receiver_id}</span>
                    </span>
                    <span className="np-text-caption np-text-secondary">
                      Gas {gasText(a.gas)} · deposit {yoctoText(a.deposit)}
                    </span>
                    <span className="npf-mandates__args">{JSON.stringify(a.args)}</span>
                  </li>
                )),
              )}
            </ol>
            <CopyField
              label="Instructions for the customer"
              value={fundingInstructionsText(ix, {
                merchant,
                symbol: asset?.symbol,
                decimals: asset?.decimals,
                invoiceUrl,
              })}
              defaultRevealed
              data-testid="funding-instructions"
            />
          </>
        ) : null}
      </div>
    </Modal>
  );
}
