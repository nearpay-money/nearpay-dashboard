/**
 * Wallet attestation of a destination (identity §8.2, lld/dashboard §1 "wallet signing"): signs exactly
 * the challenge message the API returned, after showing a human-readable summary; never edits it.
 */
import { attestSettlementDestination, getSettlementDestination, type SettlementDestination } from "@nearpay/spec";
import { useEffect, useState } from "react";
import { Link, useApp } from "../../app/context";
import { formatTime, relative } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { assetLabel } from "../../lib/money";
import { Badge, Button, Card, ErrorNote, KeyValue, Loading, Mono, Note } from "../../ui/ui";
import { discoverEvmWallets, type EvmWallet, signEip191 } from "../../wallets/evm";
import { nearConnector, signNep413 } from "../../wallets/near";

type Challenge = NonNullable<SettlementDestination["attestation_challenge"]>;

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function AttestPanel({
  destination,
  onDone,
}: {
  destination: SettlementDestination;
  onDone(d: SettlementDestination): void;
}) {
  const app = useApp();
  const c = destination.attestation_challenge as Challenge;
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [evmWallets, setEvmWallets] = useState<EvmWallet[]>();
  const expired = c.expires_at <= now;

  const submit = async (body: { standard: "nep413" | "eip191"; signature: string; public_key?: string }) => {
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

  const signNear = () =>
    run(async () => {
      if (!c.nonce || !c.recipient) throw new Error("The challenge has no NEP-413 nonce/recipient.");
      const signed = await signNep413(nearConnector, {
        message: c.message,
        recipient: c.recipient,
        nonce: c.nonce,
        address: destination.address,
      });
      await submit({ standard: "nep413", signature: signed.signature, public_key: signed.publicKey });
    });

  const signEvm = (w: EvmWallet) =>
    run(async () => {
      const signature = await signEip191(w.provider, destination.address, c.message);
      await submit({ standard: "eip191", signature });
    });

  return (
    <Card title="Prove you control this destination">
      <KeyValue
        rows={[
          ["Receive", `${assetLabel(destination.asset_id, app.assets)} (${destination.asset_id})`],
          ["Network", destination.chain],
          [
            destination.type === "intents_account" ? "Intents account" : "Address",
            <Mono key="a">{destination.address}</Mono>,
          ],
          ["Fingerprint", <Mono key="f">{destination.fingerprint}</Mono>],
          [
            "Signature",
            c.signing_standard === "nep413"
              ? "NEAR wallet (NEP-413 signMessage)"
              : c.signing_standard === "eip191"
                ? "EVM wallet (EIP-191 personal_sign)"
                : c.signing_standard,
          ],
          ["Expires", expired ? "expired" : `${relative(c.expires_at, now)} (${formatTime(c.expires_at)})`],
        ]}
      />
      <p>Your wallet will show exactly this message. Signing it moves no funds and grants no permission.</p>
      <pre className="message" data-testid="challenge-message">
        {c.message}
      </pre>
      {expired && (
        <Note tone="warn">The challenge expired. Disable this destination and add it again to get a new one.</Note>
      )}
      {!expired && c.signing_standard === "nep413" && (
        <Button busy={busy} onClick={() => void signNear()}>
          Sign with NEAR wallet
        </Button>
      )}
      {!expired && c.signing_standard === "eip191" && (
        <div className="wallets">
          {!evmWallets && (
            <Button busy={busy} onClick={() => void discoverEvmWallets().then(setEvmWallets)}>
              Sign with EVM wallet
            </Button>
          )}
          {evmWallets?.length === 0 && (
            <Note tone="warn">No EVM wallet found in this browser. Install or unlock one and retry.</Note>
          )}
          {evmWallets?.map((w) => (
            <Button key={w.id} busy={busy} onClick={() => void signEvm(w)}>
              Sign with {w.name}
            </Button>
          ))}
        </div>
      )}
      {!expired && c.signing_standard !== "nep413" && c.signing_standard !== "eip191" && (
        <Note tone="warn">This signing standard arrives in a later release.</Note>
      )}
      <ErrorNote error={error} />
    </Card>
  );
}

export function DestinationResult({ d }: { d: SettlementDestination }) {
  return (
    <Card title="Destination added">
      <p>
        <Badge value={d.status} /> {d.label} — fingerprint <Mono>{d.fingerprint}</Mono>
      </p>
      {d.status === "cooling_off" && d.active_at && (
        <Note tone="info">
          Signature verified. For your safety the destination receives payments from {formatTime(d.active_at)} (
          {relative(d.active_at)}); all owners are notified.
        </Note>
      )}
      {d.status === "pending_approval" && (
        <Note tone="info">Signature verified; waiting for a second admin to approve.</Note>
      )}
      {d.status === "active" && <Note tone="ok">Active — payments can settle here now.</Note>}
      <Link to="/settlement">Back to destinations</Link>
    </Card>
  );
}

/** `/settlement/:id/attest` — sign a pending destination later (while its challenge is still valid). */
export function AttestPage({ id }: { id: string }) {
  const app = useApp();
  const d = useAsync(() => app.api.call(getSettlementDestination, { params: { id } }), [app.api, app.mode, id]);
  const [done, setDone] = useState<SettlementDestination>();
  if (done) return <DestinationResult d={done} />;
  if (d.loading) return <Loading />;
  if (!d.data) return <ErrorNote error={d.error} />;
  if (d.data.status !== "pending_verification") return <DestinationResult d={d.data} />;
  if (!d.data.attestation_challenge) {
    return (
      <Note tone="warn">
        The signing challenge is only available right after the destination is created. Disable it and add it again.
      </Note>
    );
  }
  return <AttestPanel destination={d.data} onDone={setDone} />;
}
