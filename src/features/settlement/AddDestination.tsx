/**
 * Add a destination (Figma "Add a destination"): name, currency, network, where to receive (NEAR Intents
 * account or a wallet address on the network), then — in live mode — the wallet attestation of exactly
 * the challenge the API returns (`Attest.tsx`, unchanged rules). The request body is validated against
 * the spec schema before it is sent.
 */
import { createSettlementDestination, type SettlementDestination } from "@nearpay/spec";
import { Callout, Input, OptionCard, RadioCardGroup, Select } from "@nearpay-internal/ui";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useApp } from "../../app/context";
import { networkName } from "../../lib/chains";
import { Page } from "../../ui/page";
import { Button, ErrorNote, Field } from "../../ui/ui";
import { AttestPanel, DestinationResult } from "./Attest";

type DestType = "intents_account" | "chain_address";

export function AddDestination() {
  const app = useApp();
  const [type, setType] = useState<DestType>("intents_account");
  const [symbol, setSymbol] = useState("");
  const [assetId, setAssetId] = useState("");
  const [manualChain, setManualChain] = useState("");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [fieldError, setFieldError] = useState<{ field: string; message: string }>();
  const [created, setCreated] = useState<SettlementDestination>();
  const [done, setDone] = useState<SettlementDestination>();

  const assets = useMemo(
    () => [...app.assets.entries()].sort((a, b) => a[1].symbol.localeCompare(b[1].symbol) || a[0].localeCompare(b[0])),
    [app.assets],
  );
  const symbols = useMemo(() => [...new Set(assets.map(([, a]) => a.symbol))], [assets]);
  const networks = assets.filter(([, a]) => a.symbol === symbol);
  const assetChain = app.assets.get(assetId)?.chain;
  const chain = type === "intents_account" ? "near:mainnet" : (assetChain ?? manualChain);
  const live = app.mode === "live";

  const back = { label: "Settlement", to: "/settlement" };
  if (done)
    return (
      <Page title="Destination added" back={back} width="narrow">
        <DestinationResult d={done} />
      </Page>
    );
  if (created) {
    return (
      <Page
        title="Verify your wallet"
        subtitle="Prove you control this destination before it can receive payments."
        back={back}
        width="narrow"
      >
        {created.attestation_challenge ? (
          <AttestPanel destination={created} onDone={setDone} />
        ) : (
          <DestinationResult d={created} />
        )}
      </Page>
    );
  }

  const blocked = app.gate(createSettlementDestination);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setFieldError(undefined);
    const body = { asset_id: assetId, type, chain, address: address.trim(), label: label.trim() };
    const parsed = (createSettlementDestination.body as NonNullable<typeof createSettlementDestination.body>).safeParse(
      body,
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? "input");
      setFieldError({ field, message: issue?.message ?? "Check this value." });
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
  };
  const errFor = (f: string) => (fieldError?.field === f ? fieldError.message : undefined);

  return (
    <Page
      title="Add a destination"
      subtitle={`Tell us where your future ${app.mode} payments should arrive.`}
      back={back}
      width="narrow"
    >
      <form className="dash-form np-card np-card--pad-md" onSubmit={submit} noValidate>
        <Field label="Destination name" hint="Shown in your dashboard, e.g. Treasury." error={errFor("label")}>
          {(id) => (
            <Input
              id={id}
              maxLength={64}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              placeholder="Treasury"
            />
          )}
        </Field>
        {assets.length ? (
          <>
            <Field label="Currency" hint="The token you receive. Payers can pay with any supported token.">
              {(id) => (
                <Select
                  id={id}
                  value={symbol}
                  required
                  onChange={(e) => {
                    const sym = e.target.value;
                    setSymbol(sym);
                    const only = assets.filter(([, a]) => a.symbol === sym);
                    setAssetId(only.length === 1 ? (only[0]?.[0] ?? "") : "");
                  }}
                >
                  <option value="">Choose a currency…</option>
                  {symbols.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Network"
              hint={assetId ? <span className="dash-break">{assetId}</span> : "The network the token lives on."}
              error={errFor("asset_id")}
            >
              {(id) => (
                <Select
                  id={id}
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  disabled={!symbol}
                  required
                >
                  <option value="">{symbol ? "Choose a network…" : "Choose a currency first"}</option>
                  {networks.map(([aid, a]) => (
                    <option key={aid} value={aid}>
                      {networkName(a.chain ?? "")}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : (
          <Field label="Asset" hint="Asset id, e.g. nep141:…" error={errFor("asset_id")}>
            {(id) => (
              <Input
                id={id}
                placeholder="nep141:…"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                required
              />
            )}
          </Field>
        )}
        <RadioCardGroup label="Receive to" value={type} onChange={(v) => setType(v as DestType)}>
          <OptionCard
            value="intents_account"
            title="NEAR Intents account (recommended)"
            description="Receive any token in one account. Settles fastest."
            indicator="none"
          />
          <OptionCard
            value="chain_address"
            title={`Address on ${assetChain ? networkName(assetChain) : "the network"}`}
            description="Receive on the token's own network."
            indicator="none"
          />
        </RadioCardGroup>
        {type === "chain_address" && !assetChain && (
          <Field label="Network ID (CAIP-2)" hint="For example eip155:8453." error={errFor("chain")}>
            {(id) => (
              <Input
                id={id}
                placeholder="eip155:8453"
                value={manualChain}
                onChange={(e) => setManualChain(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field
          label={type === "intents_account" ? "NEAR Intents account" : "Wallet address"}
          hint={
            type === "intents_account"
              ? "A NEAR account (merchant.near, implicit hex) or a 0x account you control."
              : `An address you control on ${chain ? networkName(chain) : "the token's network"}.`
          }
          error={errFor("address")}
        >
          {(id) => (
            <Input
              id={id}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={type === "intents_account" ? "merchant.near" : "0x…"}
            />
          )}
        </Field>
        {live ? (
          <Callout tone="info" title="Verify, then activate">
            You'll sign a message with the wallet that controls this address. Signing moves no funds. After approval and
            the 24-hour safety window, this destination can receive new payments.
          </Callout>
        ) : (
          <Callout tone="info" title="Test destinations are active immediately">
            They receive sandbox settlements only. Test mode · no real funds move.
          </Callout>
        )}
        <ErrorNote error={error} />
        <Button type="submit" busy={busy} blocked={blocked} fullWidth className="np-button--full">
          {live ? "Connect wallet & verify" : "Add destination"}
        </Button>
        <p className="np-text-caption np-text-secondary">
          <Link to="/settlement">Cancel</Link>
        </p>
      </form>
    </Page>
  );
}
