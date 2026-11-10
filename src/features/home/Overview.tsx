/**
 * Home (design v2 artboard "Dashboard-proposed"): greeting, the two create actions, four KPI cards
 * (settled volume vs the previous week, successful payments of those started, average payment, needs
 * attention → the filtered payments list), daily volume stacked by the chain customers paid from (the
 * paying attempt's `origin_chain`), the payout wallet card and recent payments — all from real data:
 * `listPaymentIntents` (no analytics endpoint in v1) and `listSettlementDestinations`. Before the first
 * payment, while live mode is off, the onboarding checklist takes its place.
 */
import {
  listPaymentIntents,
  listSettlementDestinations,
  type PaymentIntent,
  type SettlementDestination,
} from "@nearpay/spec";
import { buttonClassName, Callout, KpiCard, KpiGrid, Skeleton, truncateMiddle } from "@nearpay-internal/ui";
import type { ReactNode } from "react";
import { Link, useApp } from "../../app/context";
import type { ApiClient } from "../../lib/api";
import { networkName } from "../../lib/chains";
import { formatDate, formatWhen, relative } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { assetLabel, formatFiat } from "../../lib/money";
import { statusOf } from "../../lib/status";
import { ErrorState, LoadingState, Page } from "../../ui/page";
import { SourceChart, type SourceDay, type SourceSeries } from "../../ui/SourceChart";
import { ErrorNote } from "../../ui/ui";
import { PaymentsTable } from "../payments/shared";
import { Setup } from "./Setup";
import { type OverviewSummary, PERIOD_DAYS, startOfDay, summarize } from "./summary";

const MAX_PAGES = 5;

/** Payments created since `since`, newest first (up to 500, enough for the Home numbers). */
async function loadSince(api: ApiClient, since: number): Promise<{ data: PaymentIntent[]; truncated: boolean }> {
  const data: PaymentIntent[] = [];
  let after: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await api.call(listPaymentIntents, {
      query: { limit: 100, "created[gte]": since, ...(after ? { starting_after: after } : {}) },
    });
    data.push(...page.data);
    const last = page.data[page.data.length - 1];
    if (!page.has_more || !last) return { data, truncated: false };
    after = last.id;
  }
  return { data, truncated: true };
}

export function SetupPage() {
  const app = useApp();
  const paid = useAsync(
    () =>
      app.mode === "test"
        ? app.api.call(listPaymentIntents, { query: { limit: 1, status: "succeeded" } })
        : Promise.resolve(undefined),
    [app.api, app.mode],
  );
  return <Setup hasTestPayment={Boolean(paid.data?.data.length)} />;
}

/** "Good morning" / "Good afternoon" / "Good evening" by the merchant's local time. */
export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Chart series: up to three chains by volume; with more, the top two and "Other chains". */
export function chartSeries(s: OverviewSummary): { series: SourceSeries[]; keyOf: (chain: string) => string } {
  const named = s.chains.length > 3 ? s.chains.slice(0, 2) : s.chains;
  const keep = new Set(named.map((c) => c.chain).filter(Boolean));
  const series: SourceSeries[] = named
    .filter((c) => c.chain)
    .map((c) => ({ key: c.chain, label: networkName(c.chain) }));
  if (s.chains.some((c) => !keep.has(c.chain))) series.push({ key: "other", label: "Other chains" });
  return { series, keyOf: (chain) => (keep.has(chain) ? chain : "other") };
}

function settledSub(
  s: OverviewSummary,
  money: (v: bigint) => string,
): { text: string; trend: "up" | "down" | "neutral" } {
  if (s.previousVolume === 0n) return { text: "Nothing settled the week before", trend: "neutral" };
  if (s.volume > s.previousVolume) return { text: `Up from ${money(s.previousVolume)} last week`, trend: "up" };
  if (s.volume < s.previousVolume) return { text: `Down from ${money(s.previousVolume)} last week`, trend: "down" };
  return { text: "Same as last week", trend: "neutral" };
}

function PayoutWalletCard({ lastPaidAt }: { lastPaidAt: number | null }) {
  const app = useApp();
  const dests = useAsync(
    () => app.api.call(listSettlementDestinations, { query: { limit: 100 } }),
    [app.api, app.mode],
  );
  const list = dests.data?.data ?? [];
  const active = list.filter((d) => d.status === "active");
  const d: SettlementDestination | undefined = active.find((x) => x.is_default) ?? active[0] ?? list[0];
  const now = Math.floor(Date.now() / 1000);
  const verification = (x: SettlementDestination) =>
    x.verification === "signature" ? "Verified" : x.verification === "test" ? "Test wallet" : "Not verified";
  const where = (x: SettlementDestination) =>
    `${assetLabel(x.asset_id, app.assets)} on ${x.type === "intents_account" ? "NEAR Intents" : networkName(x.chain)}`;
  const last =
    lastPaidAt === null
      ? "No payment yet"
      : now - lastPaidAt < 3600
        ? relative(lastPaidAt, now)
        : formatWhen(lastPaidAt, now);
  return (
    <section className="dash-card dash-payout" aria-labelledby="dash-payout-title" data-testid="payout-wallet-card">
      <h2 id="dash-payout-title" className="dash-card-title">
        Payout wallet
      </h2>
      {dests.loading && !dests.data ? (
        <div className="dash-payout__wallet">
          <Skeleton width="75" />
          <Skeleton width="50" />
        </div>
      ) : dests.error ? (
        <ErrorNote error={dests.error} onRetry={dests.reload} />
      ) : d ? (
        <div className="dash-payout__wallet">
          <p className="dash-payout__asset">{where(d)}</p>
          <p className="dash-payout__address np-tabular" title={d.address}>
            {truncateMiddle(d.address, 6, 6)}
          </p>
          <p className={`dash-payout__status dash-payout__status--${d.status === "active" ? "ok" : "wait"}`}>
            {verification(d)} · {statusOf("destination", d.status).label.toLowerCase()}
          </p>
        </div>
      ) : (
        <div className="dash-payout__wallet">
          <p className="dash-payout__asset">No payout wallet yet</p>
          <p className="np-text-small np-text-secondary">Add the wallet where payments settle.</p>
        </div>
      )}
      <dl className="dash-payout__facts">
        <div>
          <dt>Last payment arrived</dt>
          <dd>{last}</dd>
        </div>
        <div>
          <dt>Confirmations</dt>
          <dd>1 block on each chain</dd>
        </div>
      </dl>
      <Link to={d ? "/settlement" : "/settlement/new"} className="dash-payout__link">
        {d ? "Manage payout wallets" : "Add payout wallet"}
      </Link>
    </section>
  );
}

export function Overview() {
  const app = useApp();
  const now = Math.floor(Date.now() / 1000);
  const periodStart = startOfDay(now) - (PERIOD_DAYS - 1) * 86_400;
  const since = periodStart - PERIOD_DAYS * 86_400 - 3600; // previous week too (DST-safe margin)
  const recent = useAsync(() => app.api.call(listPaymentIntents, { query: { limit: 5 } }), [app.api, app.mode]);
  const period = useAsync(() => loadSince(app.api, since), [app.api, app.mode]);
  const req = app.requirements;

  if (recent.loading && !recent.data) return <LoadingState what="Loading Home" stats={4} />;
  if (recent.error) return <ErrorState title="Home" error={recent.error} onRetry={recent.reload} />;
  const hasPayments = (recent.data?.data.length ?? 0) > 0;
  if (!hasPayments && req && !req.live_enabled) return <Setup hasTestPayment={false} />;

  const s = period.data ? summarize(period.data.data, now) : undefined;
  const cur = s?.currency ?? "usd";
  const money = (v: bigint) => formatFiat(v, cur);
  const canOpen = (path: string) => {
    const r = app.registry.routes.find((x) => x.pattern === path);
    const role = app.session?.role;
    return Boolean(r) && (!r?.roles || (role !== undefined && r.roles.includes(role)));
  };
  const name = app.account?.display_name ?? app.session?.account.display_name ?? "";

  const attention = s ? s.reviews + s.delayed : 0;
  const attentionLinks: ReactNode[] = [];
  if (s?.reviews)
    attentionLinks.push(
      <Link key="r" to="/payments?status=requires_review" className="dash-kpi-link">
        {s.reviews} to review
      </Link>,
    );
  if (s?.delayed)
    attentionLinks.push(
      <Link key="d" to="/payments?status=processing" className="dash-kpi-link">
        {s.delayed} delayed
      </Link>,
    );

  let chart: ReactNode = <div className="dash-src dash-src--loading" aria-hidden="true" />;
  if (s) {
    const { series, keyOf } = chartSeries(s);
    const days: SourceDay[] = s.days.map((d) => {
      const values = new Map<string, bigint>();
      for (const [chain, v] of d.byChain) values.set(keyOf(chain), (values.get(keyOf(chain)) ?? 0n) + v);
      const displays = new Map([...values].map(([k, v]) => [k, money(v)]));
      return {
        label: formatDate(d.start).replace(/ \d{4}$/, ""),
        total: d.value,
        totalDisplay: money(d.value),
        values,
        displays,
      };
    });
    chart = (
      <SourceChart
        title="Volume by where customers paid from"
        summary={`last ${PERIOD_DAYS} days, ${cur.toUpperCase()}`}
        days={days}
        series={series}
      />
    );
  }
  const sub = s ? settledSub(s, money) : undefined;

  return (
    <Page
      className="dash-home"
      title={name ? `${greeting()}, ${name}` : greeting()}
      subtitle={`Last ${PERIOD_DAYS} days, in ${cur.toUpperCase()}. Funds settle straight to your payout wallet.`}
      actions={
        <>
          {canOpen("/billing/invoices/new") ? (
            <a href={app.href("/billing/invoices/new")} className={buttonClassName({ variant: "secondary" })}>
              <span>Create invoice</span>
            </a>
          ) : null}
          {canOpen("/payment-links/new") ? (
            <a href={app.href("/payment-links/new")} className={buttonClassName({ variant: "primary" })}>
              <span>Create payment link</span>
            </a>
          ) : null}
        </>
      }
    >
      {req && !req.live_enabled ? (
        <Callout tone="neutral" title="Live payments are not active yet">
          <p>
            Finish setup to accept real payments. <a href={app.href("/setup")}>View the checklist</a>
          </p>
        </Callout>
      ) : null}
      {period.error ? <ErrorNote error={period.error} onRetry={period.reload} /> : null}
      <KpiGrid className="dash-kpis">
        <KpiCard
          label="Settled volume"
          value={s ? money(s.volume) : <Skeleton shape="stat" width="75" />}
          sub={sub?.text}
          trend={sub?.trend}
          data-testid="kpi-volume"
        />
        <KpiCard
          label="Successful payments"
          value={s ? s.succeeded.toLocaleString("en") : <Skeleton shape="stat" width="50" />}
          sub={s ? `of ${s.total.toLocaleString("en")} started` : undefined}
          data-testid="kpi-succeeded"
        />
        <KpiCard
          label="Average payment"
          value={s ? s.average === null ? "—" : money(s.average) : <Skeleton shape="stat" width="50" />}
          sub={
            s
              ? s.paidInCurrency
                ? `across ${s.paidInCurrency} paid in ${cur.toUpperCase()}`
                : "No paid payments yet"
              : undefined
          }
          data-testid="kpi-average"
        />
        <KpiCard
          label="Needs attention"
          tone={attention > 0 ? "warning" : "default"}
          value={s ? String(attention) : <Skeleton shape="stat" width="25" />}
          sub={
            s ? (
              attention > 0 ? (
                <span className="dash-kpi-links">
                  {attentionLinks[0]}
                  {attentionLinks.length > 1 ? ", " : null}
                  {attentionLinks[1]}
                </span>
              ) : (
                "Nothing needs you right now"
              )
            ) : undefined
          }
          data-testid="kpi-attention"
        />
      </KpiGrid>
      <div className="dash-home__row">
        <div className="dash-card dash-home__chart">
          {chart}
          {s && s.otherCurrency > 0 ? (
            <p className="np-text-caption np-text-secondary">
              {s.otherCurrency} payment{s.otherCurrency === 1 ? "" : "s"} priced in another currency{" "}
              {s.otherCurrency === 1 ? "is" : "are"} not included.
            </p>
          ) : null}
          {period.data?.truncated ? (
            <p className="np-text-caption np-text-secondary">Based on your 500 most recent payments.</p>
          ) : null}
        </div>
        <PayoutWalletCard lastPaidAt={s?.lastPaidAt ?? null} />
      </div>
      <PaymentsTable
        compact
        title="Recent payments"
        actions={<Link to="/payments">View all</Link>}
        caption="Recent payments"
        intents={(recent.data?.data ?? []).slice(0, 5)}
        empty={`No ${app.mode} payments yet.`}
      />
    </Page>
  );
}
