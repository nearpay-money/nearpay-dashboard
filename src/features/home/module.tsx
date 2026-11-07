import { defineFeature } from "../../app/registry";
import { Overview, SetupPage } from "./Overview";

export default defineFeature({
  id: "home",
  nav: [{ slot: "overview", label: "Overview", href: "/" }],
  routes: [
    { name: "home", pattern: "/", section: "overview", title: "Overview", render: () => <Overview /> },
    { name: "setup", pattern: "/setup", section: "overview", title: "Get ready", render: () => <SetupPage /> },
  ],
});
