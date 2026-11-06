import { createSettlementDestination, type SettlementDestination } from "@nearpay/spec";
import { useMemo, useState } from "react";
import { useApp } from "../../app/context";
import { Button, Card, ErrorNote, Field, Note } from "../../ui/ui";
import { AttestPanel, DestinationResult } from "./Attest";

type DestType = "intents_account" | "chain_address";

export function AddDestination() {
  const app = useApp();
  const [type, setType] = useState<DestType>("intents_account");
  const [assetId, setAssetId] = useState("");
  const [manualChain, setManualChain] = useState("");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [created, setCreated] = useState<SettlementDestination>();
  const [done, setDone] = useState<SettlementDestination>();

  const assets = useMemo(
    () => [...app.assets.entries()].sort((a, b) => a[1].symbol.localeCompare(b[1].symbol)),
    [app.assets],
  );
  const assetChain = app.assets.get(assetId)?.chain;
  const chain = type === "intents_account" ? "near:mainnet" : (assetChain ?? manualChain);

  if (done) return <DestinationResult d={done} />;
  if (created) {
    if (created.attestation_challenge) return <AttestPanel destination={created} onDone={setDone} />;
    return <DestinationResult d={created} />;
  }

  const blocked = app.gate(createSettlementDestination);
  return (
    <div className="page">
      <h1>Add a {app.mode} settlement destination</h1>
      {app.mode === "test" ? (
        <Note tone="info">Test destinations are active immediately and only receive sandbox settlements.</Note>
      ) : (
        <Note tone="warn">
          Live destinations receive real funds. You will sign a message with the wallet that controls the address; the
          destination becomes usable after a cool-off.
        </Note>
      )}
      <Card>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            const body = { asset_id: assetId, type, chain, address: address.trim(), label: label.trim() };
            const parsed = (
              createSettlementDestination.body as NonNullable<typeof createSettlementDestination.body>
            ).safeParse(body);
            if (!parsed.success) {
              const issue = parsed.error.issues[0];
              setError(new Error(`${issue?.path.join(".") || "input"}: ${issue?.message ?? "invalid"}`));
              return;
            }
            setBusy(true);
            try {
              setCreated(await app.api.call(createSettlementDestination, { body }));
              app.refreshAccount();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Type">
            {(id) => (
              <select id={id} value={type} onChange={(e) => setType(e.target.value as DestType)}>
                <option value="intents_account">NEAR Intents account (recommended)</option>
                <option value="chain_address">Address on a chain</option>
              </select>
            )}
          </Field>
          <Field label="Asset" hint="The asset you receive; payers can pay with any supported token.">
            {(id) =>
              assets.length ? (
                <select id={id} value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
                  <option value="">Choose an asset…</option>
                  {assets.map(([aid, a]) => (
                    <option key={aid} value={aid}>
                      {a.symbol} — {a.chain} ({aid})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  placeholder="nep141:…"
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  required
                />
              )
            }
          </Field>
          {type === "chain_address" && !assetChain && (
            <Field label="Network (CAIP-2)">
              {(id) => (
                <input
                  id={id}
                  placeholder="eip155:8453"
                  value={manualChain}
                  onChange={(e) => setManualChain(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field
            label={type === "intents_account" ? "Intents account" : "Address"}
            hint={
              type === "intents_account"
                ? "A NEAR account (merchant.near, implicit hex) or a 0x account."
                : `Address on ${chain || "the asset's chain"}.`
            }
          >
            {(id) => (
              <input id={id} value={address} onChange={(e) => setAddress(e.target.value)} required autoComplete="off" />
            )}
          </Field>
          <Field label="Label">
            {(id) => <input id={id} maxLength={64} value={label} onChange={(e) => setLabel(e.target.value)} required />}
          </Field>
          <Button type="submit" busy={busy} blocked={blocked}>
            Add destination
          </Button>
        </form>
        <ErrorNote error={error} />
      </Card>
    </div>
  );
}
