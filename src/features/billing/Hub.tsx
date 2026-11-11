/**
 * Billing hubs (landing showcase nav: "Subscriptions" and "Invoices" are separate sidebar items): the
 * Invoices hub (tabs Invoices · Products · Tax rates) and the Subscriptions hub (tabs Subscriptions ·
 * Auto-debit [Stage 4]) share the three stats (collected this month, outstanding, active subscriptions)
 * and the "Invoice-based renewals" note. Every tab is its own route, so tabs are links (`aria-current`).
 * Stats come from list routes (no analytics endpoint in v1): the first 100 paid / open invoices and
 * active subscriptions, summed per currency with bigint arithmetic; other currencies are counted, not
 * converted, and "+" marks a capped count.
 */

import { Callout } from "@nearpay-internal/ui";
import { listInvoices, listSubscriptions } from "@nearpay-money/spec";
import type { ReactNode } from "react";
import { Link, useApp } from "../../app/context";
import { FEATURE_STAGE } from "../../app/registry";
import { summarizeAmounts } from "../../lib/billing";
import { useAsync } from "../../lib/hooks";
import { Page, StatRow } from "../../ui/page";
import "./billing.css";

export type BillingTab = "invoices" | "subscriptions" | "mandates" | "products" | "tax-rates";

const INVOICE_TABS: readonly [BillingTab, string, string][] = [
  ["invoices", "Invoices", "/billing"],
  ["products", "Products", "/billing/products"],
  ["tax-rates", "Tax rates", "/billing/tax-rates"],
];
const SUBSCRIPTION_TABS: readonly [BillingTab, string, string][] = [
  ["subscriptions", "Subscriptions", "/billing/subscriptions"],
  // stage 4 — auto-debit mandates (lld/billing.md §14)
  ...(FEATURE_STAGE >= 4 ? [["mandates", "Auto-debit", "/billing/mandates"] as [BillingTab, string, string]] : []),
];

/** Which hub a tab belongs to: its page title, subtitle and tab row. */
export function hubOf(tab: BillingTab): {
  title: string;
  subtitle: string;
  tabs: readonly [BillingTab, string, string][];
} {
  return tab === "subscriptions" || tab === "mandates"
    ? {
        title: "Subscriptions",
        subtitle: "Recurring plans, billed by emailed invoice or auto-debit.",
        tabs: SUBSCRIPTION_TABS,
      }
    : { title: "Invoices", subtitle: "Bill customers by email. They pay in the token they hold.", tabs: INVOICE_TABS };
}

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
  const hub = hubOf(tab);
  return (
    <Page title={hub.title} subtitle={hub.subtitle} actions={actions}>
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
            { label: "Active subscriptions", value: s?.active ?? "—", sub: "Emailed invoices or auto-debit" },
          ]}
        />
      )}
      <nav className="dash-tabs" aria-label={hub.title}>
        {hub.tabs.map(([id, label, href]) => (
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
          Customers approve each invoice payment from their wallet. Auto-debit is a separate opt-in: the customer funds
          a mandate they can cancel at any time.
        </Callout>
      )}
    </Page>
  );
}
