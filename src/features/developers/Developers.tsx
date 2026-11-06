import { Link, useApp } from "../../app/context";
import { ApiKeys } from "./ApiKeys";
import { EventDetail, Events } from "./Events";
import { WebhookDetail, Webhooks } from "./Webhooks";

const TABS: [string, string][] = [
  ["/developers", "API keys"],
  ["/developers/webhooks", "Webhooks"],
  ["/developers/events", "Events"],
];

export function Developers({ tab, id }: { tab: "keys" | "webhooks" | "webhook" | "events" | "event"; id?: string }) {
  const app = useApp();
  const current =
    tab === "keys" ? "/developers" : tab.startsWith("webhook") ? "/developers/webhooks" : "/developers/events";
  return (
    <div className="page">
      <h1>Developers</h1>
      <nav className="tabs" aria-label="Developers">
        {TABS.map(([p, label]) => (
          <Link key={p} to={p} className={p === current ? "tab active" : "tab"}>
            {label}
          </Link>
        ))}
      </nav>
      <p className="muted">Showing {app.mode} mode.</p>
      {tab === "keys" && <ApiKeys />}
      {tab === "webhooks" && <Webhooks />}
      {tab === "webhook" && id && <WebhookDetail id={id} />}
      {tab === "events" && <Events />}
      {tab === "event" && id && <EventDetail id={id} />}
    </div>
  );
}
