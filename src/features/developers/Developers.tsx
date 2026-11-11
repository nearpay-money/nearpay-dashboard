/** Developers (Figma "Developers"): API keys + payment notifications, notifications (webhooks), events. */
import { Link, useApp } from "../../app/context";
import { Page } from "../../ui/page";
import { ApiKeys } from "./ApiKeys";
import { EventDetail, Events } from "./Events";
import { LiveTail } from "./LiveTail";
import { Quickstart } from "./Quickstart";
import { WebhookDetail, Webhooks } from "./Webhooks";

const TABS: [string, string][] = [
  ["/developers", "API keys"],
  ["/developers/webhooks", "Notifications"],
  ["/developers/events", "Events"],
  ["/developers/live", "Live tail"],
];

export type DevelopersTab = "keys" | "webhooks" | "webhook" | "events" | "event" | "live";

export function Developers({ tab, id }: { tab: DevelopersTab; id?: string }) {
  const app = useApp();
  const current =
    tab === "keys"
      ? "/developers"
      : tab.startsWith("webhook")
        ? "/developers/webhooks"
        : tab === "live"
          ? "/developers/live"
          : "/developers/events";
  return (
    <Page
      title="Developers"
      subtitle="Manage access and verify payment notifications."
      actions={
        <Link to="/developers/start" className="np-button np-button--secondary">
          <span>Start accepting payments</span>
        </Link>
      }
    >
      <nav className="dash-tabs" aria-label="Developers">
        {TABS.map(([p, label]) => (
          <Link
            key={p}
            to={p}
            className={p === current ? "dash-tab dash-tab--current" : "dash-tab"}
            aria-current={p === current ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <p className="np-text-caption np-text-secondary">Showing {app.mode} mode.</p>
      {tab === "keys" && (
        <>
          <Quickstart />
          <ApiKeys />
          <Webhooks summary />
        </>
      )}
      {tab === "webhooks" && <Webhooks />}
      {tab === "webhook" && id && <WebhookDetail id={id} />}
      {tab === "events" && <Events />}
      {tab === "event" && id && <EventDetail id={id} />}
      {tab === "live" && <LiveTail />}
    </Page>
  );
}
