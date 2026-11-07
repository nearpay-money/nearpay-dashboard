import { useApp } from "../../app/context";
import { defineFeature } from "../../app/registry";
import { AddDestination } from "./AddDestination";
import { AttestPage } from "./Attest";
import { Destinations } from "./Destinations";

function AddDestinationRoute() {
  const app = useApp();
  return <AddDestination key={app.mode} />;
}

export default defineFeature({
  id: "settlement",
  nav: [{ slot: "settlement", label: "Settlement", href: "/settlement" }],
  routes: [
    {
      name: "settlement",
      pattern: "/settlement",
      section: "settlement",
      title: "Settlement",
      render: () => <Destinations />,
    },
    {
      name: "settlement-new",
      pattern: "/settlement/new",
      section: "settlement",
      title: "Add a destination",
      render: () => <AddDestinationRoute />,
    },
    {
      name: "settlement-attest",
      pattern: "/settlement/:id/attest",
      section: "settlement",
      title: "Verify wallet",
      render: (p) => <AttestPage id={p.id ?? ""} />,
    },
  ],
});
