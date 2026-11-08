/**
 * Building blocks shared by the billing modules (products, tax rates, invoices, subscriptions): status
 * badges, name lookups for ids the billing objects carry (customers are owned by payments, products by
 * the catalogue), catalogue loaders for the forms, and the download helper for invoice PDFs.
 */
import {
  getCustomer,
  getProduct,
  type Invoice,
  listCustomers,
  listPrices,
  listTaxRates,
  type Price,
  type Subscription,
  type TaxRate,
} from "@nearpay/spec";
import { StatusBadge } from "@nearpay-internal/ui";
import { useEffect, useRef, useState } from "react";
import { type AppState, useApp } from "../../app/context";
import { isPastDue } from "../../lib/billing";
import { shortId } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { statusOf } from "../../lib/status";

export function InvoiceStatus({ invoice, now }: { invoice: Pick<Invoice, "status" | "due_date">; now?: number }) {
  if (isPastDue(invoice, now ?? Math.floor(Date.now() / 1000)))
    return <StatusBadge tone="warning">Past due</StatusBadge>;
  const s = statusOf("invoice", invoice.status);
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

export function SubscriptionStatus({ subscription }: { subscription: Pick<Subscription, "status"> }) {
  const s = statusOf("subscription", subscription.status);
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

export function ActiveBadge({ active, inactive = "Archived" }: { active: boolean; inactive?: string }) {
  return <StatusBadge tone={active ? "success" : "neutral"}>{active ? "Active" : inactive}</StatusBadge>;
}

/** The invoice number, or `Draft · in_…0013` for drafts (numbers are assigned at finalize). */
export function invoiceTitle(i: Pick<Invoice, "number" | "id">): string {
  return i.number ?? `Draft · ${shortId(i.id)}`;
}

// ------------------------------------------------------------------------------------------------
// Name lookups (in memory per account + mode; nothing is written to web storage)
// ------------------------------------------------------------------------------------------------

type Lookup = (app: AppState, id: string) => Promise<string>;
const caches = new Map<string, Map<string, Promise<string>>>();

function cached(kind: string, app: AppState, id: string, load: Lookup): Promise<string> {
  const key = `${kind}:${app.session?.account.id}:${app.mode}`;
  let m = caches.get(key);
  if (!m) {
    m = new Map();
    caches.set(key, m);
  }
  let p = m.get(id);
  if (!p) {
    p = load(app, id);
    const mm = m;
    p.catch(() => mm.delete(id));
    m.set(id, p);
  }
  return p;
}

/** Forget a looked-up name (after an edit). */
export function forgetName(kind: "customer" | "product", id: string): void {
  for (const [k, m] of caches) if (k.startsWith(`${kind}:`)) m.delete(id);
}

const customerName: Lookup = async (app, id) => {
  const c = await app.api.call(getCustomer, { params: { id } });
  return c.name ?? c.email ?? "Unnamed customer";
};
const productName: Lookup = async (app, id) => (await app.api.call(getProduct, { params: { id } })).name;

/** Display names for ids on screen, loaded at most 4 at a time; missing entries are still loading. */
function useNames(kind: "customer" | "product", ids: readonly string[]): ReadonlyMap<string, string> {
  const app = useApp();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const key = [...new Set(ids)].sort().join(",");
  const gen = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the id set, account and mode
  useEffect(() => {
    const g = ++gen.current;
    const queue = key ? key.split(",") : [];
    const load = kind === "customer" ? customerName : productName;
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const cid = id;
        let name: string;
        try {
          name = await cached(kind, app, cid, load);
        } catch {
          name = kind === "customer" ? "Unknown customer" : "Unknown product";
        }
        if (gen.current !== g) return;
        setNames((m) => new Map(m).set(cid, name));
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
  }, [key, app.mode, app.api]);
  return names;
}

export const useCustomerNames = (ids: readonly string[]) => useNames("customer", ids);
export const useProductNames = (ids: readonly string[]) => useNames("product", ids);

// ------------------------------------------------------------------------------------------------
// Catalogue for forms
// ------------------------------------------------------------------------------------------------

const MAX = 100;

/** Active tax rates (first 100). */
export function useActiveTaxRates() {
  const app = useApp();
  return useAsync(
    async () => (await app.api.call(listTaxRates, { query: { active: "true", limit: MAX } })).data as TaxRate[],
    [app.api, app.mode],
  );
}

/** Every tax rate (first 100, active and archived) keyed by id — for showing rates on existing objects. */
export function useTaxRateIndex() {
  const app = useApp();
  return useAsync(async () => {
    const r = await app.api.call(listTaxRates, { query: { limit: MAX } });
    return new Map(r.data.map((t) => [t.id, t as TaxRate]));
  }, [app.api, app.mode]);
}

/** Active prices of one type (first 100), newest first. */
export function useActivePrices(type: "one_time" | "recurring") {
  const app = useApp();
  return useAsync(
    async () => (await app.api.call(listPrices, { query: { active: "true", type, limit: MAX } })).data as Price[],
    [app.api, app.mode, type],
  );
}

/** Customers for the pickers (first 100, newest first). */
export function useCustomerOptions() {
  const app = useApp();
  return useAsync(async () => {
    const r = await app.api.call(listCustomers, { query: { limit: MAX } });
    return { customers: r.data, more: r.has_more };
  }, [app.api, app.mode]);
}

/** Saves a Blob as a file (object URL + temporary `<a download>`; nothing is navigated). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
