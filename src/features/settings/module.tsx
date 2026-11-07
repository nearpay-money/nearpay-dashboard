import { defineFeature } from "../../app/registry";
import { AccountSettings, CORE_CARDS, NotificationSettings, SettingsIndex } from "./Settings";

export default defineFeature({
  id: "settings",
  nav: [{ slot: "settings", label: "Settings", href: "/settings" }],
  settingsCards: CORE_CARDS,
  routes: [
    { name: "settings", pattern: "/settings", section: "settings", title: "Settings", render: () => <SettingsIndex /> },
    {
      name: "settings-account",
      pattern: "/settings/account",
      section: "settings",
      title: "Account & payments",
      render: () => <AccountSettings />,
    },
    {
      name: "settings-notifications",
      pattern: "/settings/notifications",
      section: "settings",
      title: "Notifications",
      render: () => <NotificationSettings />,
    },
  ],
});
