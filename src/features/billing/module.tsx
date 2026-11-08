/**
 * Billing area (lld/dashboard-and-console.md §1 Stage 3; Figma b02 "Billing"): the sidebar slot. The
 * pages belong to the invoices, subscriptions, products and tax-rates modules, which share the Billing
 * hub (`./Hub.tsx`: stats + tabs) and the helpers in `./shared.tsx`.
 */
import { defineFeature } from "../../app/registry";

export default defineFeature({
  id: "billing",
  nav: [{ slot: "billing", label: "Billing", href: "/billing", stage: 3 }],
});
