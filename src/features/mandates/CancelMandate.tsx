/**
 * Merchant cancel of a mandate (lld/billing.md §14 d9; spec 0.4.0 `prepareMandateCancel`). NearPay holds
 * no key the vault accepts (INV-1), so the merchant's receiving NEAR Intents account signs
 * `cancel({mandate_id})` itself: the dashboard fetches the transaction, checks it is exactly that call on
 * the mandate's vault (`checkCancelTx`) and shows a human-readable summary, then either opens the NEAR
 * wallet of the receiving account (live mode, NEAR Connect — the same pinned wallets as refunds) or shows
 * the exact transaction and a near-cli command (manual path). Test mode never opens a wallet: the
 * sandbox vault is not on NEAR, so it points at the payer simulation instead. After sending, the page
 * polls the mandate until the vault's `canceled` event reaches billing (INV-2: it never assumes success).
 */

import { type Mandate, prepareMandateCancel } from "@nearpay/spec";
import { CopyField, KeyValueList, LiveRegion } from "@nearpay-internal/ui";
import { useState } from "react";
import { useApp } from "../../app/context";
import { roleAllows } from "../../lib/permissions";
import { Button, ErrorNote, Modal, Note } from "../../ui/ui";
import { nearConnector, signAndSendNear } from "../../wallets/near";
import { checkCancelTx, gasText, isEvmKeyedAccount, nearCliCommand, yoctoText } from "./logic";
import { NearTx, useToken } from "./parts";
import type { MandateCancelInstructions } from "./types";

type Step = { kind: "intro" } | { kind: "review"; ix: MandateCancelInstructions } | { kind: "sent"; tx?: string };

export function CancelMandateDialog({
  mandate,
  onClose,
  onSent,
}: {
  mandate: Mandate;
  onClose(): void;
  /** The cancel was sent: the page follows the mirror until the vault's `canceled` event arrives. */
  onSent(): void;
}) {
  const app = useApp();
  const token = useToken();
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState("");
  const live = mandate.livemode;
  const evmKeyed = isEvmKeyedAccount(mandate.merchant_receiver);
  const allowed = roleAllows(prepareMandateCancel, app.session?.role);

  const prepare = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const ix = (await app.api.call(prepareMandateCancel, {
        params: { id: mandate.id },
      })) as MandateCancelInstructions;
      const problem = checkCancelTx(mandate, ix.transaction);
      if (problem) throw new Error(`${problem} Nothing was signed. Refresh and try again, or contact support.`);
      setStep({ kind: "review", ix });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const sign = async (ix: MandateCancelInstructions) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await signAndSendNear(nearConnector, ix.transaction, mandate.merchant_receiver);
      setStep({ kind: "sent", tx: r.txHash });
      setAnnounce("Cancel sent. Waiting for the vault to confirm.");
      onSent();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const balance = token(mandate.asset_id, mandate.balance);
  const footer =
    step.kind === "intro" ? (
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Keep mandate
        </Button>
        <Button
          variant="danger"
          busy={busy}
          disabled={!allowed || evmKeyed}
          onClick={() => void prepare()}
          data-testid="prepare-cancel"
        >
          Prepare cancel transaction
        </Button>
      </>
    ) : step.kind === "review" ? (
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Close
        </Button>
        {live ? (
          <Button variant="danger" busy={busy} onClick={() => void sign(step.ix)} data-testid="sign-cancel">
            Sign with NEAR wallet
          </Button>
        ) : null}
      </>
    ) : (
      <Button onClick={onClose}>Done</Button>
    );

  return (
    <Modal
      title="Cancel this mandate?"
      description={`The vault returns the whole balance (${balance}) to the customer and stops all collections.`}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      footer={footer}
    >
      <div className="np-stack" data-testid="cancel-mandate">
        <LiveRegion>{announce}</LiveRegion>
        {step.kind === "intro" ? (
          <>
            <p>
              NearPay can't cancel mandates: the vault only accepts a cancel from the customer or from your receiving
              account <strong className="npf-mandates__account">{mandate.merchant_receiver}</strong>. You'll sign the
              cancel with that account's NEAR wallet.
            </p>
            <p className="np-text-small np-text-secondary">
              The subscription stays as it is. To stop billing too, cancel the subscription or switch it to emailed
              invoices.
            </p>
            {evmKeyed ? (
              <Note tone="warn" title="Your receiving account can't sign NEAR transactions">
                It's an EVM-keyed NEAR Intents account (0x…). Ask the customer to cancel from their wallet, or cancel
                the subscription so NearPay stops collecting and emails them how to cancel.
              </Note>
            ) : null}
            {!allowed ? <Note tone="info">Only owners, admins and finance members can cancel mandates.</Note> : null}
          </>
        ) : null}
        {step.kind === "review" ? (
          <>
            <KeyValueList
              items={[
                { label: "Sign as", value: <span className="npf-mandates__account">{mandate.merchant_receiver}</span> },
                {
                  label: "Contract",
                  value: <span className="npf-mandates__account">{step.ix.transaction.receiver_id}</span>,
                },
                ...step.ix.transaction.actions.map((a, i) => ({
                  label: step.ix.transaction.actions.length > 1 ? `Call ${i + 1}` : "Call",
                  value: `${a.method_name}(mandate ${String(a.args.mandate_id)})`,
                })),
                ...step.ix.transaction.actions.map((a) => ({
                  label: "Gas · deposit",
                  value: `${gasText(a.gas)} · ${yoctoText(a.deposit)}`,
                })),
                { label: "Returns to the customer", value: balance, total: true },
              ]}
            />
            {live ? (
              <p className="np-text-small np-text-secondary">
                Your wallet shows the same call. Approve it only if the contract is {mandate.vault_contract} and the
                method is cancel.
              </p>
            ) : (
              <Note tone="info" title="Test mode: nothing to sign">
                Test mandates live on the sandbox vault, not on NEAR, so no wallet opens. Use "Cancel as customer" under
                Test helpers to try the flow.
              </Note>
            )}
            {live ? (
              <details className="dash-disclosure">
                <summary>Sign another way (CLI or another wallet)</summary>
                <div className="np-stack">
                  <CopyField
                    label="near-cli command"
                    value={nearCliCommand(step.ix.transaction, mandate.merchant_receiver)}
                    defaultRevealed
                    data-testid="cancel-cli"
                  />
                  <CopyField label="Transaction (JSON)" value={JSON.stringify(step.ix.transaction)} defaultRevealed />
                </div>
              </details>
            ) : null}
          </>
        ) : null}
        {step.kind === "sent" ? (
          <Note tone="ok" title="Cancel sent">
            {step.tx ? (
              <>
                Transaction <NearTx hash={step.tx} livemode={live} />.{" "}
              </>
            ) : null}
            The mandate shows as canceled once the vault's event reaches NearPay, usually within a minute.
          </Note>
        ) : null}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
