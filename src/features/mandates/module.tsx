/**
 * Auto-debit module (lld/billing.md §14, lld/dashboard-and-console.md §1 "Mandates S4"; spec 0.4.0
 * `mandates`): Billing → Auto-debit tab (mandate list with filters) and the mandate page. The
 * subscription page embeds the mandate panel (`./SubscriptionMandate.tsx`).
 */

import { getMandate, listMandates } from "@nearpay-money/spec";
import { lazyPage } from "../../app/lazy";
import { defineFeature } from "../../app/registry";

const MandatesTab = lazyPage(() => import("./MandateList"), "MandatesTab", "Loading mandates");
const MandateDetail = lazyPage(() => import("./MandateDetail"), "MandateDetail", "Loading mandate");

export default defineFeature({
  id: "mandates",
  routes: [
    {
      name: "mandates",
      pattern: "/billing/mandates",
      section: "billing",
      title: "Auto-debit",
      stage: 4,
      roles: listMandates.roles,
      render: () => <MandatesTab />,
    },
    {
      name: "mandate",
      pattern: "/billing/mandates/:id",
      section: "billing",
      title: "Mandate",
      stage: 4,
      roles: getMandate.roles,
      render: (p) => <MandateDetail id={p.id ?? ""} />,
    },
  ],
});
