/**
 * Home, exactly as the landing page's dashboard showcase (nearpay-site `showcase/DashboardCard.astro`):
 * "Good morning, <business>" with the period line, three KPI cards (settled volume vs last week, successful
 * payments of those started, median time to paid), then "Recent payments" (Amount, Status, Paid with,
 * Time) beside "Volume by source chain" (daily volume stacked by the paying attempt's `origin_chain`). All
 * from real data: `listPaymentIntents` (no analytics endpoint in v1). Payments that need the merchant
 * (review, delayed) show as one line above the KPIs, linking to the filtered list. Before the first payment,
 * while live mode is off, the onboarding checklist takes its place.
 */

import { KpiCard, KpiGrid, Skeleton, WarningIcon } from "@nearpay-internal/ui";
import { listPaymentIntents, type PaymentIntent } from "@nearpay-money/spec";
import type { ReactNode } from "react";
import { Link, useApp } from "../../app/context";
import type { ApiClient } from "../../lib/api";
import { networkName } from "../../lib/chains";
import { useAsync } from "../../lib/hooks";
import { formatFiat } from "../../lib/money";
import { ErrorState, LoadingState, Page } from "../../ui/page";
import { SourceChart, type SourceDay, type SourceSeries } from "../../ui/SourceChart";
import { ErrorNote } from "../../ui/ui";
import { PaymentsTable } from "../payments/shared";
import { Setup } from "./Setup";
import { formatDuration, type OverviewSummary, PERIOD_DAYS, startOfDay, summarize } from "./summary";

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

/** Chart series: up to three chains by volume; with more, the top two and "Other". */
export function chartSeries(s: OverviewSummary): { series: SourceSeries[]; keyOf: (chain: string) => string } {
  const named = s.chains.length > 3 ? s.chains.slice(0, 2) : s.chains;
  const keep = new Set(named.map((c) => c.chain).filter(Boolean));
  const series: SourceSeries[] = named
    .filter((c) => c.chain)
    .map((c) => ({ key: c.chain, label: networkName(c.chain) }));
  if (s.chains.some((c) => !keep.has(c.chain))) series.push({ key: "other", label: "Other" });
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

const WEEKDAY = new Intl.DateTimeFormat("en", { weekday: "short" });

export function Overview() {
  const app = useApp();
  const now = Math.floor(Date.now() / 1000);
  const periodStart = startOfDay(now) - (PERIOD_DAYS - 1) * 86_400;
  const since = periodStart - PERIOD_DAYS * 86_400 - 3600; // previous week too (DST-safe margin)
  const recent = useAsync(() => app.api.call(listPaymentIntents, { query: { limit: 6 } }), [app.api, app.mode]);
  const period = useAsync(() => loadSince(app.api, since), [app.api, app.mode]);
  const req = app.requirements;

  if (recent.loading && !recent.data) return <LoadingState what="Loading Home" stats={3} />;
  if (recent.error) return <ErrorState title="Home" error={recent.error} onRetry={recent.reload} />;
  const hasPayments = (recent.data?.data.length ?? 0) > 0;
  if (!hasPayments && req && !req.live_enabled) return <Setup hasTestPayment={false} />;

  const s = period.data ? summarize(period.data.data, now) : undefined;
  const cur = s?.currency ?? "usd";
  const money = (v: bigint) => formatFiat(v, cur);
  const name = app.account?.display_name ?? app.session?.account.display_name ?? "";

  const attention = s ? s.reviews + s.delayed : 0;
  const attentionLinks: ReactNode[] = [];
  if (s?.reviews)
    attentionLinks.push(
      <Link key="r" to="/payments?status=requires_review" className="dash-attention__link">
        {s.reviews} to review
      </Link>,
    );
  if (s?.delayed)
    attentionLinks.push(
      <Link key="d" to="/payments?status=processing" className="dash-attention__link">
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
        label: WEEKDAY.format(new Date(d.start * 1000)),
        total: d.value,
        totalDisplay: money(d.value),
        values,
        displays,
      };
    });
    chart = (
      <SourceChart
        title="Volume by source chain"
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
    >
      {period.error ? <ErrorNote error={period.error} onRetry={period.reload} /> : null}
      {attention > 0 ? (
        <p className="dash-attention" data-testid="kpi-attention">
          <WarningIcon size={16} className="dash-attention__icon" />
          <span>
            {attention === 1 ? "1 payment needs" : `${attention} payments need`} your attention: {attentionLinks[0]}
            {attentionLinks.length > 1 ? ", " : null}
            {attentionLinks[1]}
          </span>
        </p>
      ) : null}
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
          label="Median time to paid"
          value={
            s ? s.medianToPaid === null ? "—" : formatDuration(s.medianToPaid) : <Skeleton shape="stat" width="50" />
          }
          sub={
            s ? (s.medianToPaid === null ? "No paid payments yet" : "from the customer choosing a token") : undefined
          }
          data-testid="kpi-median"
        />
      </KpiGrid>
      <div className="dash-home__row">
        <PaymentsTable
          compact
          title="Recent payments"
          actions={<Link to="/payments">View all</Link>}
          caption="Recent payments"
          intents={(recent.data?.data ?? []).slice(0, 6)}
          empty={`No ${app.mode} payments yet.`}
        />
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
      </div>
    </Page>
  );
}
