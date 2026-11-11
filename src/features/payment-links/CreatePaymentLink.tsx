/**
 * "Create a payment link" (Figma b01): title, price, settlement destination, fee callout and a live
 * checkout preview. Pricing is immutable after creation (INV-6), so it is validated here first and by the
 * API at creation (destination active, minimum, unverified cap, currency).
 */

import { Button, Callout, Card, Checkbox, Field, Input, PageHeader, Select } from "@nearpay-internal/ui";
import { createPaymentLink } from "@nearpay-money/spec";
import { useMemo, useState } from "react";
import { useApp } from "../../app/context";
import { roleAllows } from "../../lib/permissions";
import { useDestinations, useLinkCalls } from "./api";
import { FIAT_CURRENCIES, optionalCount, optionalUrl, parsePrice, priceText } from "./logic";
import { CheckoutPreview } from "./Preview";
import { ActionError, RoleNotice } from "./parts";
import "./payment-links.css";

const CHAINS: Readonly<Record<string, string>> = {
  "near:mainnet": "NEAR",
  "eip155:1": "Ethereum",
  "eip155:8453": "Base",
  "eip155:42161": "Arbitrum",
  "eip155:10": "Optimism",
  "eip155:137": "Polygon",
  "eip155:56": "BNB Chain",
};

export function CreatePaymentLink() {
  const app = useApp();
  const calls = useLinkCalls();
  const destinations = useDestinations();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [assetId, setAssetId] = useState("");
  const [destination, setDestination] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [successUrl, setSuccessUrl] = useState("");
  const [collectEmail, setCollectEmail] = useState(false);
  const [touched, setTouched] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const assetOptions = useMemo(
    () =>
      [...app.assets.entries()].map(([id, a]) => ({
        value: id,
        label: `${a.symbol} · ${CHAINS[a.chain ?? ""] ?? a.chain ?? "Intents"}`,
      })),
    [app.assets],
  );
  const price = parsePrice(amount, currency, { id: assetId, meta: app.assets.get(assetId) });
  const uses = optionalCount(maxUses);
  const url = optionalUrl(successUrl);
  const titleErr = title.trim() === "" ? "Enter what the customer pays for." : undefined;
  const valid = price.ok && !titleErr && uses !== undefined && url !== undefined;
  const merchant = app.account?.verified_legal_name ?? app.account?.display_name ?? "Your business";
  const payerFees = (app.account?.fee_bearer ?? "payer") === "payer";
  const blocked = app.gate(createPaymentLink);

  const header = <PageHeader title="Create a payment link" subtitle="A familiar checkout, ready to share." />;
  if (!roleAllows(createPaymentLink, app.session?.role))
    return (
      <div className="np-stack np-stack--lg">
        {header}
        <RoleNotice>Owners, admins, developers and finance members can create payment links.</RoleNotice>
      </div>
    );

  const submit = async () => {
    setTouched(true);
    if (!valid || !price.ok || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const link = await calls.create({
        pricing: price.pricing,
        description: title.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(destination ? { settlement_destination: destination } : {}),
        ...(url ? { success_url: url } : {}),
        ...(uses ? { max_uses: uses } : {}),
        collect_email: collectEmail,
      });
      app.navigate(app.href(`/payment-links/${link.id}?created=1`));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const destOptions = [
    { value: "", label: "Account default" },
    ...(destinations.data?.data ?? []).map((d) => ({
      value: d.id,
      label: `${d.label || "Destination"} · ${app.assets.get(d.asset_id)?.symbol ?? "asset"} on ${CHAINS[d.chain] ?? d.chain}`,
    })),
  ];

  return (
    <div className="np-stack np-stack--lg">
      {header}
      <div className="npf-payment-links__layout">
        <form
          className="np-stack np-stack--lg"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            label="Title"
            hint="Shown to customers on the checkout page."
            error={touched ? titleErr : undefined}
            required
          >
            <Input
              value={title}
              maxLength={500}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Acme Pro"
              data-testid="link-title"
            />
          </Field>
          <Field label="Internal name (optional)" hint="Only your team sees it, e.g. “Pro — launch campaign”.">
            <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} data-testid="link-name" />
          </Field>
          <div className="npf-payment-links__price">
            <Field label="Price" error={touched && !price.ok ? price.error : undefined} required>
              <Input
                value={amount}
                inputMode="decimal"
                numeric
                autoComplete="off"
                onChange={(e) => setAmount(e.target.value)}
                placeholder="49.00"
                data-testid="link-amount"
              />
            </Field>
            <Field label="Currency">
              <Select
                value={currency}
                options={[
                  ...FIAT_CURRENCIES,
                  ...(assetOptions.length ? [{ value: "asset", label: "Crypto asset" }] : []),
                ]}
                onChange={(e) => setCurrency(e.target.value)}
                data-testid="link-currency"
              />
            </Field>
          </div>
          {currency === "asset" && (
            <Field label="Asset">
              <Select
                value={assetId}
                placeholder="Choose an asset"
                options={assetOptions}
                onChange={(e) => setAssetId(e.target.value)}
              />
            </Field>
          )}
          <Field
            label="Receive payments in"
            hint={
              destinations.error
                ? "We couldn't load your destinations; the account default is used."
                : "Only active destinations can receive payments."
            }
          >
            <Select value={destination} options={destOptions} onChange={(e) => setDestination(e.target.value)} />
          </Field>
          <details className="npf-payment-links__more">
            <summary>More options</summary>
            <div className="np-stack">
              <Field
                label="Stop after this many payments"
                hint="Leave empty for no limit."
                error={touched && uses === undefined ? "Enter a whole number of 1 or more." : undefined}
              >
                <Input value={maxUses} inputMode="numeric" onChange={(e) => setMaxUses(e.target.value)} />
              </Field>
              <Field
                label="Redirect after payment"
                hint="An https URL. Leave empty to show NearPay's confirmation page."
                error={touched && url === undefined ? "Enter a full https URL." : undefined}
              >
                <Input value={successUrl} inputMode="url" onChange={(e) => setSuccessUrl(e.target.value)} />
              </Field>
              <Checkbox
                label="Ask for a receipt email"
                description="Customers can still pay with just a wallet."
                checked={collectEmail}
                onChange={(e) => setCollectEmail(e.target.checked)}
              />
            </div>
          </details>
          <Callout title={payerFees ? "Payer covers payment fees" : "You cover payment fees"}>
            {payerFees
              ? "The checkout shows the total before the payer approves."
              : "NearPay's fee is deducted from what you receive. Change this in Settings."}
          </Callout>
          {app.mode === "live" && app.requirements && !app.requirements.live_enabled && (
            <Callout tone="warning" title="Live mode isn't enabled yet">
              You can create the link now; customers can pay once live mode is enabled.
            </Callout>
          )}
          <Button
            type="submit"
            fullWidth
            loading={busy}
            loadingText="Creating link…"
            disabled={Boolean(blocked)}
            title={blocked ?? undefined}
            data-testid="create-link"
          >
            Create link
          </Button>
          <ActionError error={error} />
        </form>
        <Card className="npf-payment-links__preview-wrap">
          <CheckoutPreview
            merchant={merchant}
            title={title.trim()}
            price={price.ok ? priceText(price.pricing, app.assets) : null}
            payerFees={payerFees}
          />
        </Card>
      </div>
    </div>
  );
}
