/** Tax rates module (lld/billing.md §11 d1–d2, spec `billing-catalog`): Billing → Tax rates. */
import { listTaxRates } from "@nearpay-money/spec";
import { lazyPage } from "../../app/lazy";
import { defineFeature } from "../../app/registry";

const TaxRatesTab = lazyPage(() => import("./TaxRates"), "TaxRatesTab", "Loading tax rates");

export default defineFeature({
  id: "tax-rates",
  routes: [
    {
      name: "tax-rates",
      pattern: "/billing/tax-rates",
      section: "billing",
      title: "Tax rates",
      stage: 3,
      roles: listTaxRates.roles,
      render: () => <TaxRatesTab />,
    },
  ],
});
