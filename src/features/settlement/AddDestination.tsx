/**
 * Add a destination (Figma "Add a destination"): name, currency, network, where to receive (NEAR Intents
 * account or a wallet address on the network), then — in live mode — the wallet attestation of exactly
 * the challenge the API returns (`Attest.tsx`, unchanged rules). The request body is validated against
 * the spec schema before it is sent.
 * Stage 4 (identity §20): Solana and Bitcoin addresses are checked client-side first (base58 32 bytes;
 * bech32/bech32m checksum, P2WPKH/P2TR only — other Bitcoin types can't prove ownership with BIP-322
 * "simple"); Bitcoin addresses are sent lower-case. A program-derived Solana address (e.g. a Squads vault)
 * can't sign, and the unverified path has no public route yet, so it is refused in live mode with an
 * explanation.
 */
import { createSettlementDestination, type SettlementDestination } from "@nearpay/spec";
import { Callout, Input, OptionCard, RadioCardGroup, Select } from "@nearpay-internal/ui";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useApp } from "../../app/context";
import {
  bitcoinTypeRefusal,
  chainFamily,
  checkBitcoinAddress,
  checkSolanaAddress,
  networkName,
} from "../../lib/chains";
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
  const family = chainFamily(chain);
  const addrCheck = checkAddressForChain(family, address, live);

  const back = { label: "Payout wallets", to: "/settlement" };
  if (done)
    return (
      <Page title="Payout wallet added" back={back} width="narrow">
        <DestinationResult d={done} />
      </Page>
    );
  if (created) {
    return (
      <Page
        title="Verify your wallet"
        subtitle="Prove you control this wallet before it can receive payments."
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
    if (addrCheck && !addrCheck.ok) {
      setFieldError({ field: "address", message: addrCheck.error });
      return;
    }
    const body = {
      asset_id: assetId,
      type,
      chain,
      address: addrCheck?.ok ? addrCheck.normalized : address.trim(),
      label: label.trim(),
    };
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
      title="Add a payout wallet"
      subtitle={`Tell us where your future ${app.mode} payments should arrive.`}
      back={back}
      width="narrow"
    >
      <form className="dash-form np-card np-card--pad-md" onSubmit={submit} noValidate>
        <Field label="Wallet name" hint="Shown in your dashboard, e.g. Treasury." error={errFor("label")}>
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
              : family === "solana"
                ? "A Solana wallet address you can sign with (Phantom, Solflare, Backpack)."
                : family === "bitcoin"
                  ? "A native SegWit (bc1q…) or Taproot (bc1p…) address. Legacy (1…), P2SH (3…) and multisig addresses can't prove ownership."
                  : `An address you control on ${chain ? networkName(chain) : "the token's network"}.`
          }
          error={errFor("address")}
        >
          {(id) => (
            <Input
              id={id}
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                // clear a stale address error while typing (not on blur: the layout must not shift under a click)
                if (fieldError?.field === "address") setFieldError(undefined);
              }}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={
                type === "intents_account"
                  ? "merchant.near"
                  : family === "solana"
                    ? "Solana address"
                    : family === "bitcoin"
                      ? "bc1q… or bc1p…"
                      : "0x…"
              }
              onBlur={() => {
                if (addrCheck && !addrCheck.ok && address)
                  setFieldError({ field: "address", message: addrCheck.error });
              }}
              data-testid="destination-address"
            />
          )}
        </Field>
        {addrCheck?.ok && addrCheck.note ? (
          <Callout tone="warning" title={addrCheck.note.title} data-testid="address-note">
            {addrCheck.note.body}
          </Callout>
        ) : null}
        {live && type === "chain_address" && (family === "solana" || family === "bitcoin") ? (
          <Callout tone="info" title="Verify, then activate" data-testid="verify-howto">
            {family === "solana"
              ? "You'll sign a message with the Solana wallet that holds this address (Phantom, Solflare or Backpack), or paste a signature. "
              : "You'll sign a message with BIP-322 from the wallet that holds this address (Sparrow, Xverse, Leather, UniSat or OKX) and paste the signature. "}
            Signing moves no funds. After approval, and a short security hold if one applies, this destination can
            receive new payments.
          </Callout>
        ) : live ? (
          <Callout tone="info" title="Verify, then activate">
            You'll sign a message with the wallet that controls this address. Signing moves no funds. After approval,
            and a short security hold if one applies, this destination can receive new payments.
          </Callout>
        ) : (
          <Callout tone="info" title="Test payout wallets are active immediately">
            They receive sandbox settlements only. Test mode · no real funds move.
          </Callout>
        )}
        <ErrorNote error={error} />
        <Button type="submit" busy={busy} blocked={blocked} fullWidth className="np-button--full">
          {live ? "Connect wallet & verify" : "Add payout wallet"}
        </Button>
        <p className="np-text-caption np-text-secondary">
          <Link to="/settlement">Cancel</Link>
        </p>
      </form>
    </Page>
  );
}

type AddressCheck =
  | { ok: true; normalized: string; note?: { title: string; body: string } }
  | { ok: false; error: string };

/** Client-side check for Solana and Bitcoin addresses (others are left to the API). */
export function checkAddressForChain(
  family: ReturnType<typeof chainFamily>,
  address: string,
  live: boolean,
): AddressCheck | undefined {
  const a = address.trim();
  if (!a) return undefined;
  if (family === "bitcoin") {
    const r = checkBitcoinAddress(a);
    if (!r.ok) return r;
    if (!r.destinationAllowed) return { ok: false, error: bitcoinTypeRefusal(r.type) };
    return {
      ok: true,
      normalized: r.normalized,
      ...(r.normalized !== a ? { note: { title: "Saved in lower case", body: r.normalized } } : {}),
    };
  }
  if (family === "solana") {
    const r = checkSolanaAddress(a);
    if (!r.ok) return r;
    if (!r.onCurve) {
      const why =
        "This is a program-derived address (for example a Squads vault or a token account), which has no key that can sign the ownership message.";
      if (live)
        return {
          ok: false,
          error: `${why} Use a wallet address you can sign with, or receive to your NEAR Intents account. Unverified destinations aren't available in the dashboard yet.`,
        };
      return {
        ok: true,
        normalized: r.normalized,
        note: { title: "This address can't sign", body: `${why} It works in test mode only.` },
      };
    }
    return { ok: true, normalized: r.normalized };
  }
  return undefined;
}
