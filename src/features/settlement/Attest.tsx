/**
 * Wallet attestation of a destination (identity §8.2, lld/dashboard §1 "wallet signing"): signs exactly
 * the challenge message the API returned, after showing a human-readable summary; never edits it.
 * A destination still `pending_verification` whose challenge expired (or was never kept) gets a fresh one
 * with `POST /v1/settlement_destinations/{id}/challenge` (spec 0.1.5; owner/admin, step-up).
 * Stage 4 (identity §20, spec 0.4.0): Solana (`standard: solana`, wallet-standard `solana:signMessage`
 * over the raw message bytes, base58) and Bitcoin (`standard: bip322`, BIP-322 "simple", base64) — from a
 * detected wallet, or by pasting a signature made elsewhere (shape-checked before it is sent).
 */

import { CopyText, Textarea } from "@nearpay-internal/ui";
import {
  attestSettlementDestination,
  challengeSettlementDestination,
  type DESTINATION_SIGNING_STANDARDS,
  getSettlementDestination,
  type SettlementDestination,
} from "@nearpay-money/spec";
import { useEffect, useRef, useState } from "react";
import { Link, useApp } from "../../app/context";
import { checkBip322Signature, checkBitcoinAddress, checkSolanaSignature, networkName } from "../../lib/chains";
import { formatTime, relative } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { assetLabel } from "../../lib/money";

type SigningStandard = (typeof DESTINATION_SIGNING_STANDARDS)[number];

import { Page } from "../../ui/page";
import { Badge, Button, Card, ErrorNote, Field, KeyValue, Loading, Mono, Note } from "../../ui/ui";
import { type SignContext, WalletConnectButton, WalletPicker } from "../../ui/WalletPicker";
import { detectBitcoinWallets, signBip322 } from "../../wallets/bitcoin";
import { discoverEvmWallets, type EvmWallet, signEip191 } from "../../wallets/evm";
import { nearConnector, signNep413 } from "../../wallets/near";
import { discoverSolanaWallets, signSolanaMessage } from "../../wallets/solana";
import { ACTIVATING_TEXT } from "./activation";
import { approvalText } from "./Destinations";

type Challenge = NonNullable<SettlementDestination["attestation_challenge"]>;

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * "Request new challenge": issues a fresh attestation challenge for a pending destination. A missing
 * step-up opens the step-up dialog and the request is replayed with the same Idempotency-Key (ApiClient).
 */
export function RequestChallenge({
  destinationId,
  onChallenge,
  label = "Request new challenge",
}: {
  destinationId: string;
  onChallenge(d: SettlementDestination): void;
  label?: string;
}) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <>
      <Button
        busy={busy}
        blocked={app.gate(challengeSettlementDestination)}
        data-testid="request-challenge"
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            onChallenge(
              await app.api.call(challengeSettlementDestination, { params: { id: destinationId }, body: {} }),
            );
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      <ErrorNote error={error} />
    </>
  );
}

export function AttestPanel({
  destination: initial,
  onDone,
}: {
  destination: SettlementDestination;
  onDone(d: SettlementDestination): void;
}) {
  const app = useApp();
  const [destination, setDestination] = useState(initial);
  const c = destination.attestation_challenge as Challenge;
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const expired = c.expires_at <= now;

  const submit = async (body: { standard: SigningStandard; signature: string; public_key?: string }) => {
    const d = await app.api.call(attestSettlementDestination, {
      params: { id: destination.id },
      body: { challenge_id: c.id, ...body },
    });
    onDone(d);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  // Wallet actions run in the picker / connect button: only the chosen action shows progress, and a
  // signature that arrives after "Cancel" is discarded instead of submitted.
  const signNear = async (ctx: SignContext) => {
    if (!c.nonce || !c.recipient) throw new Error("The challenge has no NEP-413 nonce/recipient.");
    const signed = await signNep413(
      nearConnector,
      {
        message: c.message,
        recipient: c.recipient,
        nonce: c.nonce,
        address: destination.address,
      },
      () => ctx.setPhase("signing"),
    );
    if (ctx.signal.aborted) return;
    ctx.setPhase("verifying");
    await submit({ standard: "nep413", signature: signed.signature, public_key: signed.publicKey });
  };

  const signEvm = async (w: EvmWallet, ctx: SignContext) => {
    const signature = await signEip191(w.provider, destination.address, c.message, () => ctx.setPhase("signing"));
    if (ctx.signal.aborted) return;
    ctx.setPhase("verifying");
    await submit({ standard: "eip191", signature });
  };

  return (
    <Card title="Prove you control this wallet">
      <KeyValue
        rows={[
          ["Receive", `${assetLabel(destination.asset_id, app.assets)} (${destination.asset_id})`],
          ["Network", `${networkName(destination.chain)} (${destination.chain})`],
          [
            destination.type === "intents_account" ? "Intents account" : "Address",
            <Mono key="a">{destination.address}</Mono>,
          ],
          ["Fingerprint", <Mono key="f">{destination.fingerprint}</Mono>],
          ["Signature", STANDARD_TEXT[c.signing_standard] ?? c.signing_standard],
          ["Expires", expired ? "expired" : `${relative(c.expires_at, now)} (${formatTime(c.expires_at)})`],
        ]}
      />
      <p>Your wallet will show exactly this message. Signing it moves no funds and grants no permission.</p>
      <pre className="dash-message" data-testid="challenge-message">
        {c.message}
      </pre>
      {expired && (
        <>
          <Note tone="warn">The challenge expired. Request a new one to sign; earlier challenges stop working.</Note>
          <RequestChallenge
            destinationId={destination.id}
            onChallenge={(d) => {
              setError(undefined);
              setDestination(d);
            }}
          />
        </>
      )}
      {!expired && c.signing_standard === "nep413" && (
        <WalletConnectButton
          label="Connect NEAR wallet"
          walletName="your NEAR wallet"
          onSign={signNear}
          data-testid="near-connect"
        />
      )}
      {!expired && c.signing_standard === "eip191" && (
        <WalletPicker
          label="Connect EVM wallet"
          discover={() => discoverEvmWallets()}
          onSign={signEvm}
          installHint="Install or unlock an EVM wallet such as MetaMask, Rabby or Coinbase Wallet, then search again."
          data-testid="evm-picker"
        />
      )}
      {!expired && c.signing_standard === "solana" && (
        <SolanaSigner destination={destination} message={c.message} busy={busy} run={run} submit={submit} />
      )}
      {!expired && c.signing_standard === "bip322" && (
        <BitcoinSigner destination={destination} message={c.message} busy={busy} run={run} submit={submit} />
      )}
      {!expired && !KNOWN_STANDARDS.has(c.signing_standard) && (
        <Note tone="warn">This signing standard isn't supported by this dashboard version. Reload the page.</Note>
      )}
      <ErrorNote error={error} />
    </Card>
  );
}

const STANDARD_TEXT: Readonly<Record<string, string>> = {
  nep413: "NEAR wallet (NEP-413 signMessage)",
  eip191: "EVM wallet (EIP-191 personal_sign)",
  solana: "Solana wallet (signMessage, raw message)",
  bip322: "Bitcoin wallet (BIP-322 simple)",
};
const KNOWN_STANDARDS = new Set(Object.keys(STANDARD_TEXT));

interface SignerProps {
  destination: SettlementDestination;
  message: string;
  /** The paste form's submit is in flight (wallet signing shows its own progress in the picker). */
  busy: boolean;
  run(fn: () => Promise<void>): Promise<void>;
  submit(body: { standard: SigningStandard; signature: string }): Promise<void>;
}

/** Paste a signature made in another tool; the shape is checked before anything is sent. */
function PasteSignature({
  label,
  hint,
  check,
  busy,
  onSubmit,
  testId,
  id,
}: {
  label: string;
  hint: React.ReactNode;
  check(sig: string): string | null;
  busy: boolean;
  onSubmit(sig: string): void;
  testId: string;
  /** Anchor id, so "Paste a signature instead" in the wallet picker can scroll here. */
  id?: string;
}) {
  const [sig, setSig] = useState("");
  const [touched, setTouched] = useState(false);
  const problem = sig.trim() ? check(sig.trim()) : "Paste the signature first.";
  return (
    <form
      id={id}
      className="np-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!problem) onSubmit(sig.trim());
      }}
    >
      <Field label={label} hint={hint} error={touched ? (problem ?? undefined) : undefined}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={sig}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setSig(e.target.value)}
            data-testid={testId}
          />
        )}
      </Field>
      <div>
        <Button type="submit" variant="secondary" busy={busy}>
          Verify signature
        </Button>
      </div>
    </form>
  );
}

/** Opens (if needed), scrolls to and focuses the paste field: the picker's "Paste a signature instead". */
function revealPaste(root: HTMLElement | null, testId: string, details?: HTMLDetailsElement | null) {
  if (details) details.open = true;
  requestAnimationFrame(() => {
    const field = root?.querySelector<HTMLTextAreaElement>(`[data-testid="${testId}"]`);
    if (!field) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    field.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    field.focus({ preventScroll: true });
  });
}

function SolanaSigner({ destination, message, busy, run, submit }: SignerProps) {
  const root = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <div className="np-stack" data-testid="solana-signer" ref={root}>
      <WalletPicker
        label="Connect Solana wallet"
        discover={() => discoverSolanaWallets()}
        onSign={async (w, ctx) => {
          const signature = await signSolanaMessage(w, destination.address, message, () => ctx.setPhase("signing"));
          if (ctx.signal.aborted) return;
          ctx.setPhase("verifying");
          await submit({ standard: "solana", signature });
        }}
        onPaste={() => revealPaste(root.current, "solana-signature", details.current)}
        installHint="Install or unlock Phantom, Solflare or Backpack and search again, or paste a signature made elsewhere."
        data-testid="solana-picker"
      />
      <details className="dash-disclosure" ref={details}>
        <summary>Signed somewhere else? Paste the signature</summary>
        <div className="np-stack">
          <p className="np-text-small np-text-secondary">
            Sign the exact message above as raw UTF-8 bytes with the key of <Mono>{destination.address}</Mono>, then
            paste the 64-byte signature in base58. Not accepted: Ledger's Solana app and other "off-chain message"
            signing, Sign-In-With-Solana, and base64 signatures.
          </p>
          <PasteSignature
            label="Signature (base58)"
            hint="Letters and digits only, about 88 characters."
            check={checkSolanaSignature}
            busy={busy}
            testId="solana-signature"
            onSubmit={(signature) => void run(() => submit({ standard: "solana", signature }))}
          />
        </div>
      </details>
    </div>
  );
}

function BitcoinSigner({ destination, message, busy, run, submit }: SignerProps) {
  const root = useRef<HTMLDivElement>(null);
  const addr = checkBitcoinAddress(destination.address);
  const type = addr.ok ? addr.type : "p2wpkh";
  return (
    <div className="np-stack" data-testid="bitcoin-signer" ref={root}>
      <WalletPicker
        label="Connect Bitcoin wallet"
        discover={() => detectBitcoinWallets()}
        onSign={async (w, ctx) => {
          const signature = await signBip322(w, destination.address, message, () => ctx.setPhase("signing"));
          const problem = checkBip322Signature(signature, type);
          if (problem) throw new Error(problem);
          if (ctx.signal.aborted) return;
          ctx.setPhase("verifying");
          await submit({ standard: "bip322", signature });
        }}
        onPaste={() => revealPaste(root.current, "bip322-signature")}
        installHint="UniSat and OKX Wallet can sign here. With Sparrow, Xverse, Leather or another wallet, paste a signature."
        data-testid="bitcoin-picker"
      />
      <div className="np-stack">
        <p className="np-text-small">
          Sign the message above with the wallet that holds <Mono>{destination.address}</Mono> using{" "}
          <strong>BIP-322</strong> message signing, then paste the signature.
        </p>
        <ul className="dash-steps np-text-small np-text-secondary">
          <li>
            Sparrow: Tools → Sign/Verify Message → choose this address → paste the message → Format BIP322 → Sign.
          </li>
          <li>Xverse, Leather, UniSat, OKX: use "Sign message" with this address; they sign BIP-322 for bc1q/bc1p.</li>
          <li>Bitcoin Core's signmessage and "Electrum/legacy" formats aren't accepted.</li>
        </ul>
        <CopyText value={message} label="Copy message" data-testid="copy-challenge">
          Copy message
        </CopyText>
        <PasteSignature
          label="Signature (base64)"
          hint={type === "p2tr" ? "Taproot signatures are about 88 characters." : "Usually about 144 characters."}
          check={(sig) => checkBip322Signature(sig, type)}
          busy={busy}
          testId="bip322-signature"
          onSubmit={(signature) => void run(() => submit({ standard: "bip322", signature }))}
        />
      </div>
    </div>
  );
}

export function DestinationResult({ d }: { d: SettlementDestination }) {
  const approvals = approvalText(d);
  return (
    <Card title={d.label} actions={<Badge kind="destination" value={d.status} />}>
      <div className="np-stack">
        <KeyValue
          rows={[
            ["Fingerprint", <Mono key="f">{d.fingerprint}</Mono>],
            ["Address", <Mono key="a">{d.address}</Mono>],
          ]}
        />
        {d.status === "active" && (
          <Note tone="ok" title="Payout wallet active">
            {d.livemode
              ? `${d.verification === "signature" ? "Signature verified. " : ""}Live payments can settle to this wallet now.`
              : "Test payments settle to this wallet now (sandbox only)."}
          </Note>
        )}
        {d.status === "pending_approval" && (
          <Note tone="info" title="Signature verified.">
            Another owner or admin must approve this payout wallet{approvals ? ` (${approvals})` : ""}. It becomes
            active as soon as they approve.
          </Note>
        )}
        {/* only if the API still reports `cooling_off`: no countdown or waiting-period wording */}
        {d.status === "cooling_off" && (
          <Note tone="info" title="Signature verified.">
            {ACTIVATING_TEXT}
          </Note>
        )}
        {d.status === "disabled" && d.disabled_reason === "compliance" && (
          <Note tone="error" title="This wallet can't be used">
            It didn't pass our compliance screening, so it can't receive payments. Add a different payout wallet.
          </Note>
        )}
        <p>
          <Link to="/settlement">Back to payout wallets</Link>
        </p>
      </div>
    </Card>
  );
}

/** `/settlement/:id/attest` — sign a pending destination later (while its challenge is still valid). */
export function AttestPage({ id }: { id: string }) {
  const app = useApp();
  const d = useAsync(() => app.api.call(getSettlementDestination, { params: { id } }), [app.api, app.mode, id]);
  const [done, setDone] = useState<SettlementDestination>();
  const [fresh, setFresh] = useState<SettlementDestination>();
  const back = { label: "Payout wallets", to: "/settlement" };
  const wrap = (node: React.ReactNode) => (
    <Page
      title="Verify your wallet"
      subtitle="Prove you control this wallet before it can receive payments."
      back={back}
      width="narrow"
    >
      {node}
    </Page>
  );
  if (done) return wrap(<DestinationResult d={done} />);
  if (d.loading) return wrap(<Loading what="Loading destination" />);
  if (!d.data) return wrap(<ErrorNote error={d.error} onRetry={d.reload} />);
  if (d.data.status !== "pending_verification") return wrap(<DestinationResult d={d.data} />);
  const current = fresh ?? d.data;
  if (!current.attestation_challenge) {
    return wrap(
      <Card title="Prove you control this wallet">
        <p>
          {current.label} — fingerprint <Mono>{current.fingerprint}</Mono>
        </p>
        <Note tone="info">
          This destination is waiting for a signature from its wallet. Request a signing challenge to continue; it is
          valid for 10 minutes.
        </Note>
        <RequestChallenge destinationId={current.id} onChallenge={setFresh} label="Request signing challenge" />
      </Card>,
    );
  }
  return wrap(<AttestPanel key={current.attestation_challenge.id} destination={current} onDone={setDone} />);
}
