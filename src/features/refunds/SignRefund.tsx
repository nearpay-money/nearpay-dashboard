/**
 * Wallet review of a refund's `next_action` (lld/dashboard-and-console.md §1): a human-readable summary
 * computed from the exact payload, then the wallet signs **that payload** — never another recipient or
 * amount. `sign_intent` → NEP-413 (NEAR wallet) or ERC-191 (0x Intents account) → `submit_tx
 * {signed_intent}`; `sign_and_send` → EVM wallet transfer or the manual path → `submit_tx {tx_hash}`.
 *
 * Test mode never opens a wallet or broadcasts (test legs point at sandbox deposit addresses): the merchant
 * simulates the signed transfer with `simulateRefundDeposit` instead.
 */
import { type Refund, simulateRefundDeposit, submitRefundTx } from "@nearpay/spec";
import {
  Button,
  Callout,
  CopyField,
  Countdown,
  Field,
  Input,
  KeyValueList,
  Money,
  truncateMiddle,
} from "@nearpay-internal/ui";
import { useMemo, useState } from "react";
import { useApp } from "../../app/context";
import { WalletPicker } from "../../ui/WalletPicker";
import { discoverEvmWallets, type EvmWallet, signEip191 } from "../../wallets/evm";
import { nearConnector, signNep413 } from "../../wallets/near";
import { useRefundCalls } from "./api";
import { chainLabel, checkNextAction, intentSigner, type SignAndSend, type SignIntent } from "./logic";
import { ActionError, ErrorState } from "./parts";
import { erc191MultiPayload, evmTransfer, nep413MultiPayload, sendEvmTransfer } from "./signing";
import { assetText } from "./ui";

export interface SignRefundProps {
  readonly refund: Refund;
  readonly onUpdated: (r: Refund, announce: string) => void;
}

export function SignRefund({ refund, onUpdated }: SignRefundProps) {
  const app = useApp();
  if (app.mode === "test") return <SimulateReturn refund={refund} onUpdated={onUpdated} />;
  const a = refund.next_action;
  if (!a) return null;
  return a.type === "sign_intent" ? (
    <SignIntentReview refund={refund} action={a} onUpdated={onUpdated} />
  ) : (
    <SendReview refund={refund} action={a} onUpdated={onUpdated} />
  );
}

function useCheck(refund: Refund) {
  return useMemo(() => {
    if (!refund.next_action) return null;
    try {
      checkNextAction(refund, refund.next_action);
      return null;
    } catch (e) {
      return e;
    }
  }, [refund]);
}

function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

function Recipient({ refund }: { refund: Refund }) {
  const app = useApp();
  const sym = app.assets.get(refund.recipient.asset_id)?.symbol ?? "asset";
  return (
    <span>
      {truncateMiddle(refund.recipient.address, 6, 4)} · {sym} · {chainLabel(refund.recipient.chain)}
      {refund.recipient.overridden ? " (address changed by an owner)" : " (original payer)"}
    </span>
  );
}

function Deadline({ unix, onExpire }: { unix: number; onExpire: () => void }) {
  return (
    <span>
      <Countdown deadline={unix * 1000} onExpire={onExpire} /> left
    </span>
  );
}

const WALLET_FEE = "Your wallet may charge a separate network fee. Review it before approving.";

function SignIntentReview({ refund, action: a, onUpdated }: SignRefundProps & { action: SignIntent }) {
  const app = useApp();
  const calls = useRefundCalls();
  const mismatch = useCheck(refund);
  const { busy, error, run } = useRun();
  const [expired, setExpired] = useState(false);
  const signer = intentSigner(a);
  const sym = app.assets.get(a.transfer.token)?.symbol;
  const blocked = app.gate(submitRefundTx);

  if (mismatch) return <ErrorState error={mismatch} title="This return can't be signed" />;

  const submit = async (signed: Parameters<typeof calls.submitSigned>[1]) => {
    const r = await calls.submitSigned(refund.id, signed);
    onUpdated(r, "Return signed and submitted. We confirm it automatically.");
  };

  return (
    <div className="np-stack" data-testid="sign-intent">
      <KeyValueList
        items={[
          {
            label: "You transfer",
            value: <strong>{assetText(a.transfer.amount, a.transfer.token, refund.decimals, sym)}</strong>,
          },
          { label: "From your Intents account", value: <code className="npf-refunds__mono">{a.signer_id}</code> },
          { label: "To", value: <code className="npf-refunds__mono">{a.transfer.receiver_id}</code> },
          { label: "Returns to", value: <Recipient refund={refund} /> },
          { label: "Reference (memo)", value: <code className="npf-refunds__mono">{a.transfer.memo}</code> },
          { label: "Sign within", value: <Deadline unix={a.deadline} onExpire={() => setExpired(true)} /> },
        ]}
      />
      <p className="np-text-caption np-text-secondary" data-testid="api-summary">
        Prepared by NearPay: {a.display}
      </p>
      <p className="np-text-caption np-text-secondary">
        You sign one NEAR Intents transfer with exactly these details. NearPay only relays what you sign.
      </p>
      {expired ? (
        <Callout tone="warning" title="The signing window closed">
          Close this review and prepare a new return.
        </Callout>
      ) : signer === "nep413" ? (
        <Button
          fullWidth
          loading={busy === "near"}
          loadingText="Waiting for your wallet…"
          disabled={Boolean(blocked)}
          onClick={() =>
            run("near", async () => {
              const signed = await signNep413(nearConnector, {
                message: a.nep413.message,
                recipient: a.nep413.recipient,
                nonce: a.nep413.nonce,
                address: a.signer_id,
              });
              await submit(nep413MultiPayload(a, signed));
            })
          }
          data-testid="sign-near"
        >
          Sign with NEAR wallet
        </Button>
      ) : signer === "erc191" ? (
        <WalletPicker<EvmWallet>
          label="Connect EVM wallet"
          discover={() => discoverEvmWallets()}
          disabled={Boolean(blocked)}
          onSign={async (w, ctx) => {
            ctx.setPhase("signing");
            const sig = await signEip191(w.provider, a.signer_id, a.payload);
            if (ctx.signal.aborted) return;
            ctx.setPhase("verifying");
            await submit(erc191MultiPayload(a, sig));
          }}
          installHint={`Install or unlock the wallet that controls ${truncateMiddle(a.signer_id, 6, 4)}, then search again.`}
          data-testid="refund-evm-picker"
        />
      ) : (
        <Callout tone="warning" title="No supported signing method">
          This Intents account can't be signed from the dashboard ({a.standards.join(", ")}).
        </Callout>
      )}
      <p className="np-text-caption np-text-secondary">{WALLET_FEE}</p>
      <ActionError error={error} />
    </div>
  );
}

function SendReview({ refund, action: a, onUpdated }: SignRefundProps & { action: SignAndSend }) {
  const app = useApp();
  const calls = useRefundCalls();
  const mismatch = useCheck(refund);
  const { busy, error, run } = useRun();
  const [expired, setExpired] = useState(false);
  const canWallet = evmTransfer(a) !== null;
  const [manual, setManual] = useState(!canWallet);
  const [hash, setHash] = useState("");
  const [sender, setSender] = useState("");
  const needsSender = a.chain.startsWith("near:");
  const leg = refund.legs[0];
  const recipientAsset = app.assets.get(refund.recipient.asset_id);
  const blocked = app.gate(submitRefundTx);

  if (mismatch) return <ErrorState error={mismatch} title="This return can't be signed" />;

  const reported = async (tx: string, from?: string) => {
    const r = await calls.submitTx(refund.id, tx, from);
    onUpdated(r, "Transfer reported. We confirm the return automatically.");
  };

  return (
    <div className="np-stack" data-testid="sign-send">
      <KeyValueList
        items={[
          {
            label: "You send",
            value: (
              <strong>
                <Money amount={a.amount} decimals={a.decimals} symbol={a.symbol} /> on {chainLabel(a.chain)}
              </strong>
            ),
          },
          { label: "From your settlement wallet", value: <code className="npf-refunds__mono">{a.from}</code> },
          { label: "To the return route", value: <code className="npf-refunds__mono">{a.to}</code> },
          ...(a.memo ? [{ label: "Memo (required)", value: <code className="npf-refunds__mono">{a.memo}</code> }] : []),
          {
            label: "Payer receives (estimate)",
            value:
              leg?.amount_out_expected && recipientAsset ? (
                <Money
                  amount={leg.amount_out_expected}
                  decimals={recipientAsset.decimals}
                  symbol={recipientAsset.symbol}
                />
              ) : (
                "Set by the route"
              ),
          },
          { label: "Returns to", value: <Recipient refund={refund} /> },
          { label: "Send within", value: <Deadline unix={a.deadline} onExpire={() => setExpired(true)} /> },
        ]}
      />
      <p className="np-text-caption np-text-secondary" data-testid="api-summary">
        Prepared by NearPay: {a.display}
      </p>
      {expired ? (
        <Callout tone="warning" title="The signing window closed">
          Don't send. Close this review and prepare a new return; a late transfer returns to your wallet.
        </Callout>
      ) : manual ? (
        <div className="np-stack">
          <Callout tone="warning" title={`Use the ${chainLabel(a.chain)} network`}>
            This address accepts {a.symbol} on {chainLabel(a.chain)} only. Send exactly{" "}
            <Money amount={a.amount} decimals={a.decimals} symbol={a.symbol} /> from {truncateMiddle(a.from, 6, 4)}.
            {a.memo ? " Include the memo, or the return can't be matched." : ""} We confirm automatically.
          </Callout>
          <CopyField label="Return route address" value={a.to} defaultRevealed />
          <Field label="Transaction hash" hint="Paste the hash after sending. It speeds up confirmation." required>
            <Input
              value={hash}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setHash(e.target.value.trim())}
              data-testid="tx-hash"
            />
          </Field>
          {needsSender && (
            <Field label="Sending account" hint="The NEAR account you sent from.">
              <Input value={sender} autoComplete="off" onChange={(e) => setSender(e.target.value.trim())} />
            </Field>
          )}
          <Button
            fullWidth
            loading={busy === "manual"}
            disabled={hash.length < 8 || Boolean(blocked)}
            onClick={() => run("manual", () => reported(hash, needsSender && sender ? sender : undefined))}
            data-testid="report-tx"
          >
            I've sent it — report transaction
          </Button>
          {canWallet && (
            <Button variant="ghost" onClick={() => setManual(false)}>
              Use a browser wallet instead
            </Button>
          )}
        </div>
      ) : (
        <div className="np-stack np-stack--sm">
          <WalletPicker<EvmWallet>
            label="Connect EVM wallet"
            discover={() => discoverEvmWallets()}
            disabled={Boolean(blocked)}
            onSign={async (w, ctx) => {
              ctx.setPhase("signing");
              const tx = await sendEvmTransfer(w.provider, a);
              // the transfer is already broadcast: report it even if "Cancel" was pressed meanwhile
              ctx.setPhase("verifying");
              await reported(tx);
            }}
            installHint={`Unlock the wallet that controls ${truncateMiddle(a.from, 6, 4)} and search again, or send it yourself.`}
            data-testid="refund-send-picker"
          />
          <Button variant="secondary" fullWidth onClick={() => setManual(true)} data-testid="send-manually">
            Send it yourself
          </Button>
        </div>
      )}
      <p className="np-text-caption np-text-secondary">{WALLET_FEE}</p>
      <ActionError error={error} />
    </div>
  );
}

function SimulateReturn({ refund, onUpdated }: SignRefundProps) {
  const app = useApp();
  const calls = useRefundCalls();
  const { busy, error, run } = useRun();
  const a = refund.next_action;
  const sym = app.assets.get(refund.asset_id)?.symbol;
  return (
    <div className="np-stack" data-testid="simulate-return">
      <Callout tone="warning" title="Test mode — no real funds" reference="Sandbox refund">
        No wallet opens in test mode and nothing is broadcast. Simulate the signed transfer to see the return complete.
      </Callout>
      <KeyValueList
        items={[
          { label: "Refund amount", value: assetText(refund.amount, refund.asset_id, refund.decimals, sym) },
          { label: "Returns to", value: <Recipient refund={refund} /> },
          ...(a ? [{ label: "Prepared by NearPay", value: a.display }] : []),
        ]}
      />
      <Button
        fullWidth
        loading={busy === "sim"}
        disabled={Boolean(app.gate(simulateRefundDeposit))}
        onClick={() =>
          run("sim", async () => {
            await calls.simulate(refund.id);
            onUpdated(await calls.get(refund.id), "Simulated transfer sent. The return is confirming.");
          })
        }
        data-testid="simulate-transfer"
      >
        Simulate signed transfer
      </Button>
      <ActionError error={error} />
    </div>
  );
}
