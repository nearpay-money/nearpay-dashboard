import { defineFeature } from "../../app/registry";
import { AddResource, AgentPaymentDetail, AgentPayments } from "./AgentPayments";

export default defineFeature({
  id: "agent-payments",
  nav: [{ slot: "agent-payments", label: "Agent payments", href: "/agent-payments" }],
  routes: [
    {
      name: "agent-payments",
      pattern: "/agent-payments",
      section: "agent-payments",
      title: "Agent payments",
      render: () => <AgentPayments />,
    },
    {
      name: "agent-resource-new",
      pattern: "/agent-payments/new",
      section: "agent-payments",
      title: "Add a paid resource",
      render: () => <AddResource />,
    },
    {
      name: "agent-payment",
      pattern: "/agent-payments/:id",
      section: "agent-payments",
      title: "Agent payment",
      render: (p) => <AgentPaymentDetail id={p.id ?? ""} />,
    },
  ],
});
