/** Product and price dialogs (create/edit product, add price). Pricing is immutable after creation. */
import { createPrice, createProduct, type Price, type Product, updateProduct } from "@nearpay/spec";
import { Button, Field, Input, Modal, SegmentedControl, Select, Textarea } from "@nearpay-internal/ui";
import { useState } from "react";
import { useApp } from "../../app/context";
import { BILLING_CURRENCIES } from "../../lib/billing";
import { ErrorNote } from "../../ui/ui";
import { forgetName } from "../billing/shared";
import { checkPrice, checkProductName, emptyPrice, type PriceErrors, type PriceForm } from "./logic";

const INTERVALS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

export function PriceFields({
  value,
  onChange,
  errors,
}: {
  value: PriceForm;
  onChange: (p: PriceForm) => void;
  errors: PriceErrors;
}) {
  const app = useApp();
  const set = (p: Partial<PriceForm>) => onChange({ ...value, ...p });
  return (
    <div className="np-stack">
      <SegmentedControl
        label="Billing"
        items={[
          { id: "recurring", label: "Recurring" },
          { id: "one_time", label: "One-time" },
        ]}
        value={value.type}
        onChange={(id) => set({ type: id as PriceForm["type"] })}
      />
      <div className="npf-billing__row-2">
        <Field label="Amount" error={errors.amount}>
          <Input
            inputMode="decimal"
            numeric
            value={value.amount}
            placeholder="49.00"
            onChange={(e) => set({ amount: e.target.value })}
            data-testid="price-amount"
          />
        </Field>
        <Field label="Currency" error={errors.currency}>
          <Select
            value={value.currency}
            onChange={(e) => set({ currency: e.target.value, assetId: "" })}
            options={[...BILLING_CURRENCIES, { value: "asset", label: "Crypto asset" }]}
            data-testid="price-currency"
          />
        </Field>
      </div>
      {value.currency === "asset" ? (
        <Field label="Asset" hint="The customer pays this exact amount of the asset.">
          <Select
            value={value.assetId}
            placeholder="Choose an asset"
            onChange={(e) => set({ assetId: e.target.value })}
            options={[...app.assets.entries()].map(([id, a]) => ({
              value: id,
              label: `${a.symbol}${a.chain ? ` · ${a.chain}` : ""}`,
            }))}
          />
        </Field>
      ) : null}
      {value.type === "recurring" ? (
        <div className="npf-billing__row-2">
          <Field label="Every" error={errors.intervalCount}>
            <Input
              inputMode="numeric"
              numeric
              value={value.intervalCount}
              onChange={(e) => set({ intervalCount: e.target.value })}
            />
          </Field>
          <Field label="Period">
            <Select
              value={value.interval}
              options={INTERVALS}
              onChange={(e) => set({ interval: e.target.value as PriceForm["interval"] })}
              data-testid="price-interval"
            />
          </Field>
        </div>
      ) : null}
      <Field
        label="Internal label (optional)"
        error={errors.nickname}
        hint="Only your team sees it, e.g. “Launch pricing”."
      >
        <Input value={value.nickname} maxLength={100} onChange={(e) => set({ nickname: e.target.value })} />
      </Field>
    </div>
  );
}

/** Create a product with its first price, or edit a product's name and description. */
export function ProductDialog({
  open,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  product?: Product;
  onClose: () => void;
  onSaved: (p: Product) => void;
}) {
  const app = useApp();
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState<PriceForm>(emptyPrice);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [created, setCreated] = useState<Product>();
  const nameErr = checkProductName(name, description);
  const p = checkPrice(price, app.assets);
  const errs = touched ? nameErr : {};
  const save = async () => {
    setTouched(true);
    if (Object.keys(nameErr).length || (!product && !p.body)) return;
    setBusy(true);
    setError(undefined);
    try {
      let saved: Product;
      if (product) {
        saved = await app.api.call(updateProduct, {
          params: { id: product.id },
          body: { name: name.trim(), description: description.trim() || null },
        });
        forgetName("product", product.id);
      } else {
        // a retry after a failed price keeps the product created by the first attempt
        saved =
          created ??
          (await app.api.call(createProduct, {
            body: { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) },
          }));
        setCreated(saved);
        if (p.body) await app.api.call(createPrice, { body: { product: saved.id, ...p.body } });
      }
      onSaved(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? "Edit product" : "Add a product"}
      description={
        product ? "Changes apply to invoices finalized from now on." : "Something you sell, with its first price."
      }
      dismissible={!busy}
      data-testid="product-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()} data-testid="save-product">
            {product ? "Save product" : "Add product"}
          </Button>
        </>
      }
    >
      <div className="np-stack">
        <Field label="Name" error={errs.name} hint="Shown on invoices and the payment page.">
          <Input value={name} maxLength={250} onChange={(e) => setName(e.target.value)} data-testid="product-name" />
        </Field>
        <Field label="Description (optional)" error={errs.description}>
          <Textarea rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {!product ? (
          <fieldset className="npf-billing__fieldset">
            <legend className="np-text-h4">Price</legend>
            <PriceFields value={price} onChange={setPrice} errors={touched ? p.errors : {}} />
          </fieldset>
        ) : null}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

export function PriceDialog({
  open,
  productId,
  onClose,
  onSaved,
}: {
  open: boolean;
  productId: string;
  onClose: () => void;
  onSaved: (p: Price) => void;
}) {
  const app = useApp();
  const [price, setPrice] = useState<PriceForm>(emptyPrice);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const p = checkPrice(price, app.assets);
  const save = async () => {
    setTouched(true);
    if (!p.body) return;
    setBusy(true);
    setError(undefined);
    try {
      onSaved((await app.api.call(createPrice, { body: { product: productId, ...p.body } })) as Price);
      setPrice(emptyPrice());
      setTouched(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a price"
      description="Prices can't be changed once created. To change pricing, add a new price and deactivate the old one — existing subscriptions keep their price until you change them."
      dismissible={!busy}
      data-testid="price-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()} data-testid="save-price">
            Add price
          </Button>
        </>
      }
    >
      <PriceFields value={price} onChange={setPrice} errors={touched ? p.errors : {}} />
      <ErrorNote error={error} />
    </Modal>
  );
}
