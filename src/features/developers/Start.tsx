/**
 * Start accepting payments (Figma developer onboarding): environment / checkout / notifications status
 * and the four integration steps, each reflecting real account state (keys, destinations, webhook
 * endpoints, a succeeded payment) in the current mode.
 */

import { buttonClassName, Card, CardTitle, ExternalLinkIcon, type StepItem, Steps } from "@nearpay-internal/ui";
import { listApiKeys, listPaymentIntents, listSettlementDestinations, listWebhookEndpoints } from "@nearpay-money/spec";
import { useApp } from "../../app/context";
import { useAsync } from "../../lib/hooks";
import { Page, StatRow } from "../../ui/page";

export const DOCS_URL = "https://docs.nearpay.money/quickstart";

export function Start() {
  const app = useApp();
  const deps = [app.api, app.mode];
  const keys = useAsync(() => app.api.call(listApiKeys, { query: { limit: 100 } }), deps);
  const dests = useAsync(() => app.api.call(listSettlementDestinations, { query: { limit: 100 } }), deps);
  const hooks = useAsync(() => app.api.call(listWebhookEndpoints, { query: { limit: 100 } }), deps);
  const paid = useAsync(() => app.api.call(listPaymentIntents, { query: { limit: 1, status: "succeeded" } }), deps);
  const test = app.mode === "test";
  const hasKey = (keys.data?.data ?? []).some((k) => k.type !== "publishable");
  const ready = (dests.data?.data ?? []).some((d) => d.status === "active");
  const endpoints = (hooks.data?.data ?? []).filter((e) => e.status === "enabled").length;
  const hasPayment = (paid.data?.data.length ?? 0) > 0;
  const loading = keys.loading || dests.loading || hooks.loading || paid.loading;
  const done = [hasKey, ready, endpoints > 0, hasPayment];
  const current = done.indexOf(false);
  const st = (i: number): StepItem["status"] => (done[i] ? "complete" : i === current ? "current" : "upcoming");
  const link = (to: string, label: string, i: number) => (
    <a
      href={app.href(to)}
      className={buttonClassName({ variant: i === current ? "primary" : "secondary" }, "dash-step-action")}
    >
      <span>{label}</span>
    </a>
  );
  return (
    <Page title="Start accepting payments" subtitle="Follow your first payment from checkout to confirmation.">
      <StatRow
        loading={loading}
        items={[
          {
            label: "Environment",
            value: test ? "Test mode" : "Live mode",
            sub: test ? "No real funds move" : "Real payments",
          },
          {
            label: "Checkout",
            value: ready ? "Ready" : "Not ready",
            sub: ready ? "Hosted or embedded" : "Add a settlement destination first",
          },
          {
            label: "Notifications",
            value: endpoints ? "Connected" : "Not connected",
            sub: endpoints ? `${endpoints} endpoint${endpoints === 1 ? "" : "s"}` : "Add an endpoint for events",
          },
        ]}
      />
      <div className="dash-detail">
        <Steps
          label="Integration steps"
          items={[
            {
              id: "key",
              title: `Create a ${app.mode} key`,
              description: "Choose permissions for your integration.",
              status: st(0),
              action: link("/developers?create=secret", "Create key", 0),
            },
            {
              id: "checkout",
              title: "Choose checkout",
              description: ready
                ? "Hosted checkout or an embedded payment panel."
                : "Add a settlement destination so checkout can settle.",
              status: st(1),
              action: link(ready ? "/developers" : "/settlement/new", ready ? "View keys" : "Add destination", 1),
            },
            {
              id: "notifications",
              title: "Connect payment notifications",
              description: "Receive verified payment outcomes.",
              status: st(2),
              action: link("/developers/webhooks", "Add endpoint", 2),
            },
            {
              id: "payment",
              title: `Run a ${app.mode} payment`,
              description: "Review successful, delayed and failed payments.",
              status: st(3),
              action: link("/payments", "View payments", 3),
            },
          ]}
        />
        <Card as="aside" className="dash-side-card" aria-label="Create your key">
          <div className="np-stack">
            <CardTitle>Create your {app.mode} key</CardTitle>
            <p className="np-text-secondary">Keep secret keys private. You'll see a new secret key only once.</p>
            <a
              href={app.href("/developers?create=secret")}
              className={buttonClassName({ variant: "primary", fullWidth: true })}
            >
              <span>Create {app.mode} key</span>
            </a>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClassName({ variant: "secondary", fullWidth: true })}
            >
              <span>Open integration guide</span>
              <ExternalLinkIcon size={16} />
            </a>
          </div>
        </Card>
      </div>
    </Page>
  );
}
