/**
 * Invoices module (lld/billing.md §5, spec `invoices`; Figma b02 "Billing" + "Create invoice", mobile
 * "Invoice INV–2041"): the Billing hub's Invoices tab (`/billing`), create, draft edit and detail.
 */
import { createInvoice, getInvoice, listInvoices, updateInvoice } from "@nearpay-money/spec";
import { lazyPage } from "../../app/lazy";
import { defineFeature } from "../../app/registry";

const InvoicesTab = lazyPage(() => import("./InvoiceList"), "InvoicesTab", "Loading invoices");
const InvoiceDetail = lazyPage(() => import("./InvoiceDetail"), "InvoiceDetail", "Loading invoice");
const InvoiceEditor = lazyPage(() => import("./InvoiceForm"), "InvoiceEditor", "Loading invoice form");

export default defineFeature({
  id: "invoices",
  routes: [
    {
      name: "billing",
      pattern: "/billing",
      section: "billing",
      title: "Billing",
      stage: 3,
      roles: listInvoices.roles,
      render: () => <InvoicesTab />,
    },
    {
      name: "invoice-new",
      pattern: "/billing/invoices/new",
      section: "billing",
      title: "Create invoice",
      stage: 3,
      roles: createInvoice.roles,
      render: () => <InvoiceEditor />,
    },
    {
      name: "invoice-edit",
      pattern: "/billing/invoices/:id/edit",
      section: "billing",
      title: "Edit draft invoice",
      stage: 3,
      roles: updateInvoice.roles,
      render: (p) => <InvoiceEditor id={p.id ?? ""} />,
    },
    {
      name: "invoice",
      pattern: "/billing/invoices/:id",
      section: "billing",
      title: "Invoice",
      stage: 3,
      roles: getInvoice.roles,
      render: (p) => <InvoiceDetail id={p.id ?? ""} />,
    },
  ],
});
