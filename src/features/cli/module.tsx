/** CLI login approval (lld/identity.md §6.2): `/cli/authorize`, a focused page without the workspace shell. */
import { lazyPage } from "../../app/lazy";
import { defineFeature } from "../../app/registry";

const CliAuthorize = lazyPage(() => import("./CliAuthorize"), "CliAuthorize", "Loading");

export default defineFeature({
  id: "cli",
  routes: [
    {
      name: "cli-authorize",
      pattern: "/cli/authorize",
      section: "developers",
      title: "Authorize NearPay CLI",
      stage: 3,
      layout: "focus",
      render: () => <CliAuthorize />,
    },
  ],
});
