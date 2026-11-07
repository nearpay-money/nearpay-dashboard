import { defineFeature } from "../../app/registry";
import { Developers } from "./Developers";
import { Start } from "./Start";

export default defineFeature({
  id: "developers",
  nav: [{ slot: "developers", label: "Developers", href: "/developers" }],
  routes: [
    {
      name: "developers",
      pattern: "/developers",
      section: "developers",
      title: "Developers",
      render: () => <Developers tab="keys" />,
    },
    {
      name: "developers-start",
      pattern: "/developers/start",
      section: "developers",
      title: "Start accepting payments",
      render: () => <Start />,
    },
    {
      name: "webhooks",
      pattern: "/developers/webhooks",
      section: "developers",
      title: "Notifications",
      render: () => <Developers tab="webhooks" />,
    },
    {
      name: "webhook",
      pattern: "/developers/webhooks/:id",
      section: "developers",
      title: "Endpoint",
      render: (p) => <Developers tab="webhook" id={p.id ?? ""} />,
    },
    {
      name: "events",
      pattern: "/developers/events",
      section: "developers",
      title: "Events",
      render: () => <Developers tab="events" />,
    },
    {
      name: "event",
      pattern: "/developers/events/:id",
      section: "developers",
      title: "Event",
      render: (p) => <Developers tab="event" id={p.id ?? ""} />,
    },
  ],
});
