/**
 * "Review refund" (Figma b01, dashboard canvas): amount with what is still refundable, network-fee
 * handling, reason, the "Returns to the original payer" callout and the refund summary panel.
 * "Review in wallet" creates the refund (Idempotency-Key from the client; one request per click) and
 * opens the wallet review on the refund page, where the exact `next_action` is signed.
 */

import {
  Button,
  Callout,
  Card,
  CardTitle,
  Field,
  Input,
  KeyValueList,
  Money,
  OptionCard,
  PageHeader,
  RadioCardGroup,
  Select,
} from "@nearpay-internal/ui";
import { createRefund, type PaymentIntent } from "@nearpay-money/spec";
import { useId, useMemo, useState } from "react";
import { Link, useApp } from "../../app/context";
import { roleAllows } from "../../lib/permissions";
import { useIntent, useRefundCalls } from "./api";
import {
  canRefund,
  chainLabel,
  FEE_MODES,
  payingAttempt,
  REASONS,
  refundableAmount,
  shortRef,
  unitsToInput,
  validateRefundAmount,
} from "./logic";
import { ActionError, ErrorState, PageSkeleton, RoleNotice } from "./parts";
import "./refunds.css";

type Reason = (typeof REASONS)[number]["value"];
type FeeMode = (typeof FEE_MODES)[number]["value"];

export function ReviewRefund({ paymentId }: { paymentId: string }) {
  const intent = useIntent(paymentId);
  if (intent.loading && !intent.data) return <PageSkeleton label="Loading payment" />;
  if (intent.error || !intent.data)
    return <ErrorState error={intent.error} onRetry={intent.reload} title="We couldn't load this payment" />;
  return <RefundForm intent={intent.data} />;
}

interface Target {
  readonly key: string;
  readonly attempt?: string;
  readonly label: string;
  readonly available: bigint;
  readonly originAsset: string;
  readonly originChain: string;
}

function targets(intent: PaymentIntent): Target[] {
  const paying = payingAttempt(intent);
  const out: Target[] = [];
  if (paying)
    out.push({
      key: "payment",
      label: "Payment",
      available: refundableAmount(intent),
      originAsset: paying.origin_asset_id,
      originChain: paying.origin_chain,
    });
  for (const o of intent.overpayments) {
    const a = intent.attempts.find((x) => x.id === o.attempt);
    out.push({
      key: o.attempt,
      attempt: o.attempt,
      label: "Overpayment",
      // the server enforces the per-attempt remainder (settled − its refunds)
      available: BigInt(o.amount),
      originAsset: a?.origin_asset_id ?? intent.settlement_asset_id,
      originChain: a?.origin_chain ?? intent.destination.chain,
    });
  }
  return out;
}

function RefundForm({ intent }: { intent: PaymentIntent }) {
  const app = useApp();
  const calls = useRefundCalls();
  const settle = app.assets.get(intent.settlement_asset_id);
  const decimals = settle?.decimals;
  const symbol = settle?.symbol ?? "units";
  const options = useMemo(() => targets(intent), [intent]);
  const [targetKey, setTargetKey] = useState(options[0]?.key ?? "payment");
  const target = options.find((o) => o.key === targetKey) ?? options[0];
  const [amountText, setAmountText] = useState(() =>
    target && decimals !== undefined ? unitsToInput(target.available, decimals) : "",
  );
  const [feeMode, setFeeMode] = useState<FeeMode>("payer_absorbs");
  const [reason, setReason] = useState<Reason>(target?.attempt ? "overpayment" : "requested_by_customer");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const summaryId = useId();

  const blocked = app.gate(createRefund);
  const ref = shortRef("NP", intent.id);
  const header = (
    <PageHeader
      title="Review refund"
      subtitle={
        <>
          Payment <Link to={`/payments/${intent.id}`}>{ref}</Link> · Refunds require your wallet authorization.
        </>
      }
    />
  );

  if (!roleAllows(createRefund, app.session?.role)) {
    return (
      <div className="np-stack np-stack--lg">
        {header}
        <RoleNotice>Only owners, admins and finance members can refund payments.</RoleNotice>
      </div>
    );
  }
  if (!canRefund(intent) && !options.some((o) => o.attempt)) {
    return (
      <div className="np-stack np-stack--lg">
        {header}
        <Callout tone="neutral" title="This payment can't be refunded">
          Only paid payments with a settled amount can be refunded.{" "}
          <Link to={`/payments/${intent.id}`}>Back to the payment</Link>
        </Callout>
      </div>
    );
  }
  if (decimals === undefined || !target) {
    return (
      <div className="np-stack np-stack--lg">
        {header}
        <ErrorState error={new Error("The settlement asset of this payment is not in the asset list. Reload.")} />
      </div>
    );
  }

  const check = validateRefundAmount(amountText, decimals, target.available);
  const nothingLeft = target.available === 0n;
  const showError = touched && !check.ok;
  const amount = check.ok ? check.value : "0";

  const submit = async () => {
    setTouched(true);
    if (!check.ok || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await calls.create({
        payment_intent: intent.id,
        ...(target.attempt ? { payment_attempt: target.attempt } : {}),
        amount: check.value,
        reason,
        fee_mode: feeMode,
      });
      app.navigate(app.href(`/refunds/${r.id}?review=1`));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="np-stack np-stack--lg">
      {header}
      <div className="npf-refunds__layout">
        <Card className="npf-refunds__form">
          <form
            className="np-stack np-stack--lg"
            noValidate
            aria-describedby={summaryId}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {options.length > 1 && (
              <RadioCardGroup
                label="What to refund"
                value={targetKey}
                onChange={(v) => {
                  setTargetKey(v);
                  const t = options.find((o) => o.key === v);
                  if (t) {
                    setAmountText(unitsToInput(t.available, decimals));
                    if (t.attempt) setReason("overpayment");
                  }
                }}
              >
                {options.map((o) => (
                  <OptionCard
                    key={o.key}
                    value={o.key}
                    title={o.label}
                    description={`Up to ${unitsToInput(o.available, decimals)} ${symbol}`}
                    indicator="none"
                  />
                ))}
              </RadioCardGroup>
            )}
            <Field
              label="Refund amount"
              hint={
                <>
                  Available to refund: <Money amount={target.available} decimals={decimals} symbol={symbol} />
                </>
              }
              error={showError && !check.ok ? check.error : nothingLeft ? "Nothing is left to refund." : undefined}
              required
            >
              <Input
                inputMode="decimal"
                autoComplete="off"
                numeric
                value={amountText}
                trailing={symbol}
                onChange={(e) => setAmountText(e.target.value)}
                onBlur={() => setTouched(true)}
                data-testid="refund-amount"
              />
            </Field>
            <Field
              label="Network fees"
              hint={
                feeMode === "payer_absorbs"
                  ? "You send the refund amount; route costs come out of what the payer receives."
                  : "The payer receives the full amount; you send slightly more to cover route costs."
              }
            >
              <Select
                value={feeMode}
                options={FEE_MODES}
                onChange={(e) => setFeeMode(e.target.value as FeeMode)}
                data-testid="refund-fee-mode"
              />
            </Field>
            <Field label="Reason">
              <Select value={reason} options={REASONS} onChange={(e) => setReason(e.target.value as Reason)} />
            </Field>
            <Callout title="Returns to the original payer" data-testid="returns-to">
              {app.assets.get(target.originAsset)?.symbol ?? "The paid asset"} on {chainLabel(target.originChain)} · the
              payer's recorded refund address.{" "}
              {feeMode === "payer_absorbs"
                ? "The payer receives the refund less network costs."
                : "The payer receives the full refund amount."}{" "}
              The exact address and final estimate appear before signing.
            </Callout>
            <Button
              type="submit"
              fullWidth
              loading={busy}
              loadingText="Preparing the return…"
              disabled={nothingLeft || Boolean(blocked)}
              title={blocked ?? undefined}
              data-testid="review-in-wallet"
            >
              Review in wallet
            </Button>
            {blocked && <p className="np-text-caption np-text-secondary">{blocked}</p>}
            <ActionError error={error} />
          </form>
        </Card>
        <aside className="npf-refunds__summary" aria-labelledby={`${summaryId}-t`} id={summaryId}>
          <CardTitle as="h2">
            <span id={`${summaryId}-t`}>Refund summary</span>
          </CardTitle>
          <KeyValueList
            items={[
              { label: "Refund basis", value: target.attempt ? "Overpaid amount" : "Settled amount" },
              { label: "Refund amount", value: <Money amount={amount} decimals={decimals} symbol={symbol} /> },
              { label: "NearPay refund fee", value: <Money amount="0" decimals={decimals} symbol={symbol} /> },
              {
                label: "Network costs",
                value: feeMode === "payer_absorbs" ? "Shown before signing" : "Added to what you send",
              },
            ]}
          />
          <p className="np-text-secondary">
            A refund is only marked complete after the return is verified. Closing the wallet leaves this refund
            unapproved.
          </p>
          <p className="np-text-caption np-text-secondary">
            Funds settle directly to your chosen wallet. NearPay does not hold your balance — the return is sent from
            your settlement wallet.
          </p>
        </aside>
      </div>
    </div>
  );
}
