import { defineFeature } from "../../app/registry";
import { PaymentDetail } from "./PaymentDetail";
import { PaymentsList } from "./PaymentsList";

export default defineFeature({
  id: "payments",
  nav: [{ slot: "payments", label: "Payments", href: "/payments" }],
  routes: [
    { name: "payments", pattern: "/payments", section: "payments", title: "Payments", render: () => <PaymentsList /> },
    {
      name: "payment",
      pattern: "/payments/:id",
      section: "payments",
      title: "Payment",
      render: (p) => <PaymentDetail id={p.id ?? ""} />,
    },
  ],
});
