/**
 * Billing hub (Figma b02 "Billing"): title, the three stats (collected this month, outstanding,
 * active subscriptions), the tab row (Invoices · Subscriptions · Products · Tax rates) and the
 * "Invoice-based renewals" note. Every tab is its own route, so tabs are links (`aria-current`).
 * Stats come from list routes (no analytics endpoint in v1): the first 100 paid / open invoices and
 * active subscriptions, summed per currency with bigint arithmetic; other currencies are counted, not
 * converted, and "+" marks a capped count.
 */
import { listInvoices, listSubscriptions } from "@nearpay/spec";
import { Callout } from "@nearpay-internal/ui";
import type { ReactNode } from "react";
import { Link, useApp } from "../../app/context";
import { summarizeAmounts } from "../../lib/billing";
import { useAsync } from "../../lib/hooks";
import { Page, StatRow } from "../../ui/page";
import "./billing.css";

export type BillingTab = "invoices" | "subscriptions" | "products" | "tax-rates";

const TABS: readonly [BillingTab, string, string][] = [
  ["invoices", "Invoices", "/billing"],
  ["subscriptions", "Subscriptions", "/billing/subscriptions"],
  ["products", "Products", "/billing/products"],
  ["tax-rates", "Tax rates", "/billing/tax-rates"],
];

function monthStart(now = new Date()): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

function useBillingStats() {
  const app = useApp();
  return useAsync(async () => {
    const since = monthStart();
    const [paid, open, active] = await Promise.all([
      app.api.call(listInvoices, { query: { status: "paid", limit: 100, "created[gte]": since - 62 * 86_400 } }),
      app.api.call(listInvoices, { query: { status: "open", limit: 100 } }),
      app.api.call(listSubscriptions, { query: { status: "active", limit: 100 } }),
    ]);
    const paidThisMonth = paid.data.filter((i) => (i.status_transitions.paid_at ?? 0) >= since);
    return {
      collected: summarizeAmounts(
        paidThisMonth.map((i) => ({ amount: i.amount_paid, currency: i.currency, asset_id: i.asset_id })),
        app.assets,
      ),
      collectedPartial: paid.has_more,
      outstanding: summarizeAmounts(
        open.data.map((i) => ({ amount: i.amount_remaining, currency: i.currency, asset_id: i.asset_id })),
        app.assets,
      ),
      openCount: `${open.data.length}${open.has_more ? "+" : ""}`,
      active: `${active.data.length}${active.has_more ? "+" : ""}`,
    };
  }, [app.api, app.mode, app.assets]);
}

const others = (n: number) => (n > 0 ? ` · +${n} other ${n === 1 ? "currency" : "currencies"}` : "");

export function BillingHub({
  tab,
  actions,
  note,
  children,
}: {
  tab: BillingTab;
  actions?: ReactNode;
  /** Callout under the tab content; default "Invoice-based renewals". */
  note?: ReactNode;
  children: ReactNode;
}) {
  const stats = useBillingStats();
  const s = stats.data;
  return (
    <Page title="Billing" subtitle="Invoices and recurring payments, in one place." actions={actions}>
      {stats.error ? null : (
        <StatRow
          loading={stats.loading && !s}
          items={[
            {
              label: "Collected this month",
              value: s?.collected.text ?? "—",
              sub: `Invoice payments${s ? others(s.collected.others) : ""}`,
            },
            {
              label: "Outstanding",
              value: s?.outstanding.text ?? "—",
              sub: s
                ? `${s.openCount} open invoice${s.openCount === "1" ? "" : "s"}${others(s.outstanding.others)}`
                : "",
            },
            { label: "Active subscriptions", value: s?.active ?? "—", sub: "Invoice-based renewals" },
          ]}
        />
      )}
      <nav className="dash-tabs" aria-label="Billing">
        {TABS.map(([id, label, href]) => (
          <Link
            key={id}
            to={href}
            className={id === tab ? "dash-tab dash-tab--current" : "dash-tab"}
            aria-current={id === tab ? "page" : undefined}
            data-testid={`billing-tab-${id}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
      {note ?? (
        <Callout title="Invoice-based renewals">
          Customers approve each invoice payment from their wallet. Automatic debit is a separate opt-in product.
        </Callout>
      )}
    </Page>
  );
}
