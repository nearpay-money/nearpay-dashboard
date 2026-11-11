/**
 * Product detail: name, description, status (archive / restore), and its prices — add a price,
 * deactivate or reactivate one. Pricing is immutable (INV-6); a price change is a new price.
 */

import { Button, Callout, KeyValueList, LiveRegion, MenuButton, MoreIcon, Table, useToast } from "@nearpay-internal/ui";
import { getProduct, listPrices, type Price, type Product, updatePrice, updateProduct } from "@nearpay-money/spec";
import { useState } from "react";
import { useApp } from "../../app/context";
import { intervalText, priceSummary } from "../../lib/billing";
import { formatDate } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { roleAllows } from "../../lib/permissions";
import { ConfirmDialog, ErrorState, LoadingState, Page, Section } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import "../billing/billing.css";
import { ActiveBadge, forgetName } from "../billing/shared";
import { PriceDialog, ProductDialog } from "./forms";

export function ProductDetail({ id }: { id: string }) {
  const app = useApp();
  const p = useAsync(() => app.api.call(getProduct, { params: { id } }) as Promise<Product>, [id, app.api, app.mode]);
  if (p.loading && !p.data) return <LoadingState what="Loading product" />;
  if (p.error || !p.data) return <ErrorState title="Product" error={p.error} onRetry={p.reload} />;
  return <ProductView key={p.data.id} initial={p.data} />;
}

function ProductView({ initial }: { initial: Product }) {
  const app = useApp();
  const toast = useToast();
  const [product, setProduct] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState(() =>
    new URLSearchParams(app.location.search).get("created") === "1" ? "Product added." : "",
  );
  const prices = useAsync(
    async () => (await app.api.call(listPrices, { query: { product: product.id, limit: 100 } })).data as Price[],
    [app.api, app.mode, product.id],
  );
  const canEdit = roleAllows(updateProduct, app.session?.role);

  const setActive = async (active: boolean) => {
    setBusy("product");
    setError(undefined);
    try {
      const p = await app.api.call(updateProduct, { params: { id: product.id }, body: { active } });
      setProduct(p as Product);
      forgetName("product", product.id);
      setArchiving(false);
      const msg = active
        ? "Product restored."
        : "Product archived. Its prices can't be used on new invoices or subscriptions.";
      setAnnounce(msg);
      toast.show({ tone: "success", title: active ? "Product restored" : "Product archived" });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };
  const togglePrice = async (price: Price) => {
    setBusy(price.id);
    setError(undefined);
    try {
      await app.api.call(updatePrice, { params: { id: price.id }, body: { active: !price.active } });
      setAnnounce(price.active ? "Price deactivated." : "Price activated.");
      prices.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Page
      title={product.name}
      subtitle={product.description ?? "No description"}
      status={<ActiveBadge active={product.active} />}
      back={{ label: "Products", to: "/billing/products" }}
      actions={
        canEdit ? (
          <>
            <Button
              variant="ghost"
              onClick={() => (product.active ? setArchiving(true) : void setActive(true))}
              loading={busy === "product"}
              data-testid="archive-product"
            >
              {product.active ? "Archive" : "Restore"}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)} data-testid="edit-product">
              Edit
            </Button>
            <Button
              onClick={() => setAdding(true)}
              disabled={!product.active}
              title={product.active ? undefined : "Restore the product to add prices."}
              data-testid="add-price"
            >
              Add price
            </Button>
          </>
        ) : undefined
      }
      data-testid="product-detail"
    >
      <LiveRegion>{announce}</LiveRegion>
      <ErrorNote error={error} />
      {!product.active ? (
        <Callout tone="neutral" title="Archived">
          Its prices can't be put on new invoices or subscriptions. Existing subscriptions keep billing it.
        </Callout>
      ) : null}
      <Section title="Prices">
        {prices.error ? (
          <ErrorNote error={prices.error} onRetry={prices.reload} />
        ) : (
          <Table<Price>
            caption="Prices"
            loading={prices.loading && !prices.data}
            rows={prices.data ?? []}
            rowKey={(p) => p.id}
            empty="No prices yet. Add one to use this product on invoices or subscriptions."
            columns={[
              { key: "a", header: "Price", primary: true, cell: (p) => priceSummary(p, app.assets) },
              {
                key: "t",
                header: "Type",
                cell: (p) => (p.recurring ? `Recurring · every ${intervalText(p.recurring)}` : "One-time"),
              },
              { key: "n", header: "Label", hideOnNarrow: true, cell: (p) => p.nickname ?? "—" },
              { key: "s", header: "Status", cell: (p) => <ActiveBadge active={p.active} inactive="Inactive" /> },
              { key: "c", header: "Created", hideOnNarrow: true, cell: (p) => formatDate(p.created) },
              ...(canEdit
                ? [
                    {
                      key: "x",
                      header: <span className="np-sr-only">Actions</span>,
                      cell: (p: Price) => (
                        <MenuButton
                          label={`Actions for ${priceSummary(p, app.assets)}`}
                          triggerLabel={`Actions for ${priceSummary(p, app.assets)}`}
                          variant="ghost"
                          align="end"
                          disabled={busy === p.id}
                          items={[
                            { id: "toggle", label: p.active ? "Deactivate price" : "Activate price", danger: p.active },
                          ]}
                          onSelect={() => void togglePrice(p)}
                        >
                          <MoreIcon size={18} />
                        </MenuButton>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
        <p className="np-text-caption np-text-secondary">
          Prices can't be edited. To change pricing, add a new price and deactivate the old one.
        </p>
      </Section>
      <Section title="Details">
        <KeyValueList
          items={[
            { label: "Product ID", value: <code className="npf-billing__mono">{product.id}</code> },
            { label: "Created", value: formatDate(product.created) },
            { label: "Updated", value: formatDate(product.updated) },
          ]}
        />
      </Section>
      {editing ? (
        <ProductDialog
          open
          product={product}
          onClose={() => setEditing(false)}
          onSaved={(p) => {
            setProduct(p);
            setEditing(false);
            setAnnounce("Product saved.");
          }}
        />
      ) : null}
      <PriceDialog
        open={adding}
        productId={product.id}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          setAnnounce("Price added.");
          prices.reload();
        }}
      />
      <ConfirmDialog
        open={archiving}
        title="Archive this product?"
        description="Its prices can't be put on new invoices or subscriptions. Existing subscriptions keep billing it, and you can restore it later."
        confirmLabel="Archive product"
        busy={busy === "product"}
        error={error}
        onClose={() => setArchiving(false)}
        onConfirm={() => void setActive(false)}
      />
    </Page>
  );
}
