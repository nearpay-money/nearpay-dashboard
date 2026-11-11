/**
 * Developers quickstart, drawn after the landing `DevelopersCard`: a navy panel with the one call that
 * creates a hosted checkout (`@nearpay-money/node`) and, under it, the account's latest events in this
 * mode (real `listEvents`, newest first) as a terminal-style log linking to each event.
 */
import { type Event, listEvents } from "@nearpay-money/spec";
import { Link, useApp } from "../../app/context";
import { useAsync } from "../../lib/hooks";
import { DOCS_URL } from "./Start";

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const NOUNS: Readonly<Record<string, string>> = {
  pi: "payment",
  cs: "checkout",
  re: "refund",
  in: "invoice",
  sub: "subscription",
  md: "mandate",
  cus: "customer",
  plink: "link",
  sd: "wallet",
  ap: "agent",
};

/** What the event is about, in a word ("payment", "invoice"), from its object id prefix. */
function objectNoun(e: Event): string {
  const o = e.data.object as { id?: unknown };
  const prefix = typeof o.id === "string" ? (o.id.split("_")[0] ?? "") : "";
  return NOUNS[prefix] ?? "event";
}

export function Quickstart() {
  const app = useApp();
  const events = useAsync(() => app.api.call(listEvents, { query: { limit: 4 } }), [app.api, app.mode]);
  const rows = events.data?.data ?? [];
  return (
    <section className="dash-dev" aria-labelledby="dash-dev-title" data-testid="dev-quickstart">
      <div className="dash-dev__intro">
        <h2 id="dash-dev-title" className="dash-dev__title">
          One API call to a hosted checkout
        </h2>
        <p className="dash-dev__body">
          Create a checkout session, send your customer to its URL, and listen for <code>payment_intent.succeeded</code>
          .
        </p>
        <p className="dash-dev__links">
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            Read the quickstart
          </a>
          <Link to="/developers/start">Start accepting payments</Link>
        </p>
      </div>
      <div className="dash-dev__term">
        <p className="dash-dev__bar">
          <span className="dash-dev__dots" aria-hidden="true" />
          server.ts
        </p>
        <pre className="dash-dev__code">
          <code>
            <span className="dash-dev__c">{"// Create a checkout session\n"}</span>
            {"const session = await nearpay.checkout.sessions.create({\n"}
            {"  amount: "}
            <span className="dash-dev__n">4900</span>
            {", currency: "}
            <span className="dash-dev__s">"usd"</span>
            {",\n  success_url: "}
            <span className="dash-dev__s">"https://shop.example/thanks"</span>
            {",\n});\n\n"}
            <span className="dash-dev__c">{"// Send the customer to the hosted checkout\n"}</span>
            {"res.redirect(session.url);"}
          </code>
        </pre>
        <div className="dash-dev__events">
          <p className="dash-dev__events-head">
            <span className="dash-dev__live" aria-hidden="true" />
            Events
            <span className="dash-dev__mode">{app.mode === "test" ? "Test mode" : "Live mode"}</span>
          </p>
          {events.loading && !events.data ? (
            <p className="dash-dev__empty">Loading events…</p>
          ) : rows.length === 0 ? (
            <p className="dash-dev__empty">No events in {app.mode} mode yet. They appear here as payments happen.</p>
          ) : (
            <ul className="dash-dev__log" aria-label="Latest events">
              {rows.map((e) => (
                <li key={e.id}>
                  <Link to={`/developers/events/${e.id}`} className="dash-dev__row">
                    <span className="dash-dev__time">{TIME.format(e.created * 1000)}</span>
                    <span className="dash-dev__type">{e.type}</span>
                    <span className="dash-dev__obj">{objectNoun(e)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
