/**
 * Billing → Products (catalogue): filter active/archived, table Product · Pricing · Status · Updated,
 * "Add product" with its first price. Pricing per product comes from one `listPrices` (active, ≤ 100).
 */

import { Button, FilterBar, FilterPill, Pager, Table } from "@nearpay-internal/ui";
import { createProduct, listPrices, listProducts, type Price, type Product } from "@nearpay-money/spec";
import { useState } from "react";
import { useApp } from "../../app/context";
import { priceSummary } from "../../lib/billing";
import { formatDate } from "../../lib/format";
import { useAsync, useCursorList } from "../../lib/hooks";
import { roleAllows } from "../../lib/permissions";
import { Empty } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import { BillingHub } from "../billing/Hub";
import { ActiveBadge } from "../billing/shared";
import { ProductDialog } from "./forms";

type Filter = "true" | "false" | "";
const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "true", label: "Active" },
  { value: "false", label: "Archived" },
  { value: "", label: "All" },
];

export function ProductsTab() {
  const app = useApp();
  const raw = new URLSearchParams(app.location.search).get("active");
  const active: Filter = raw === "false" ? "false" : raw === "all" ? "" : "true";
  const [adding, setAdding] = useState(false);
  const canAdd = roleAllows(createProduct, app.session?.role);
  const list = useCursorList<Product>(
    async (after) => {
      const r = await app.api.call(listProducts, {
        query: { limit: 20, ...(active ? { active } : {}), ...(after ? { starting_after: after } : {}) },
      });
      return { data: r.data as Product[], has_more: r.has_more };
    },
    [app.api, app.mode, active],
    20,
  );
  const prices = useAsync(
    async () => (await app.api.call(listPrices, { query: { active: "true", limit: 100 } })).data as Price[],
    [app.api, app.mode, list.data],
  );
  const rows = list.data?.data ?? [];
  const add = canAdd ? (
    <Button onClick={() => setAdding(true)} data-testid="add-product">
      Add product
    </Button>
  ) : undefined;
  const pricing = (p: Product) => {
    if (!prices.data) return prices.error ? "—" : "…";
    const mine = prices.data.filter((x) => x.product === p.id);
    if (!mine.length) return "No active price";
    const first = mine[0] as Price;
    return `${priceSummary(first, app.assets)}${mine.length > 1 ? ` · +${mine.length - 1} more` : ""}`;
  };
  return (
    <BillingHub tab="products" actions={add}>
      <FilterBar label="Product filters">
        <FilterPill
          label="Status"
          options={FILTERS}
          value={active}
          defaultValue="true"
          onChange={(v) =>
            app.navigate(`/billing/products${v === "true" ? "" : `?active=${v || "all"}`}`, { replace: true })
          }
        />
      </FilterBar>
      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : !list.loading && rows.length === 0 && !list.hasPrevious && active === "true" ? (
        <Empty
          title="No products yet"
          action={add}
          footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
        >
          Add what you sell with its price — one-time for invoices, recurring for subscriptions.
        </Empty>
      ) : (
        <div data-testid="product-table">
          <Table<Product>
            caption="Products"
            loading={list.loading && !list.data}
            rows={rows}
            rowKey={(p) => p.id}
            rowHref={(p) => app.href(`/billing/products/${p.id}`)}
            empty="No products match this filter."
            columns={[
              {
                key: "n",
                header: "Product",
                primary: true,
                cell: (p) => (
                  <span className="npf-billing__line">
                    <span>{p.name}</span>
                    {p.description ? <span className="np-text-small np-text-secondary">{p.description}</span> : null}
                  </span>
                ),
              },
              { key: "p", header: "Pricing", cell: pricing },
              { key: "s", header: "Status", cell: (p) => <ActiveBadge active={p.active} /> },
              { key: "u", header: "Updated", hideOnNarrow: true, cell: (p) => formatDate(p.updated) },
            ]}
            footer={
              list.hasNext || list.hasPrevious ? (
                <Pager
                  hasPrevious={list.hasPrevious}
                  hasNext={list.hasNext}
                  onPrevious={list.previous}
                  onNext={list.next}
                />
              ) : undefined
            }
          />
        </div>
      )}
      {adding ? (
        <ProductDialog
          open
          onClose={() => setAdding(false)}
          onSaved={(p) => {
            setAdding(false);
            app.navigate(app.href(`/billing/products/${p.id}?created=1`));
          }}
        />
      ) : null}
    </BillingHub>
  );
}
