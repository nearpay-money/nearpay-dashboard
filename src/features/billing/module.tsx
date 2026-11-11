/**
 * Billing area (lld/dashboard-and-console.md §1 Stage 3): two sidebar slots, as on the landing showcase —
 * Subscriptions (subscriptions + auto-debit mandates) and Invoices (invoices, products, tax rates). The
 * pages belong to the invoices, subscriptions, mandates, products and tax-rates modules, which share the
 * hub (`./Hub.tsx`: stats + tabs) and the helpers in `./shared.tsx`.
 */
import { defineFeature } from "../../app/registry";

export default defineFeature({
  id: "billing",
  nav: [
    { slot: "subscriptions", label: "Subscriptions", href: "/billing/subscriptions", stage: 3 },
    { slot: "invoices", label: "Invoices", href: "/billing", stage: 3 },
  ],
});
