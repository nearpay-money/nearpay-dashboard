/**
 * Overview (Figma "Your payments, in focus."; mobile b04): settled volume with the change vs the previous
 * week, successful payments, what needs attention, the daily volume chart and recent payments — all from
 * `listPaymentIntents`. Before the first payment, while live mode is off, the onboarding checklist
 * takes its place.
 */
import { listPaymentIntents, type PaymentIntent } from "@nearpay/spec";
import { buttonClassName, Callout } from "@nearpay-internal/ui";
import { useApp } from "../../app/context";
import type { ApiClient } from "../../lib/api";
import { formatDate, formatLongDate } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { formatFiat } from "../../lib/money";
import { ErrorState, LoadingState, Page, Section, StatRow } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import { VolumeChart } from "../../ui/VolumeChart";
import { PaymentsTable } from "../payments/shared";
import { Setup } from "./Setup";
import { formatPermille, PERIOD_DAYS, startOfDay, summarize } from "./summary";

const MAX_PAGES = 5;

/** Payments created since `since`, newest first (up to 500, enough for the overview numbers). */
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

export function Overview() {
  const app = useApp();
  const now = Math.floor(Date.now() / 1000);
  const periodStart = startOfDay(now) - (PERIOD_DAYS - 1) * 86_400;
  const since = periodStart - PERIOD_DAYS * 86_400 - 3600; // previous week too (DST-safe margin)
  const recent = useAsync(() => app.api.call(listPaymentIntents, { query: { limit: 5 } }), [app.api, app.mode]);
  const period = useAsync(() => loadSince(app.api, since), [app.api, app.mode]);
  const req = app.requirements;

  if (recent.loading && !recent.data) return <LoadingState what="Loading your overview" stats={3} />;
  if (recent.error) return <ErrorState title="Overview" error={recent.error} onRetry={recent.reload} />;
  const hasPayments = (recent.data?.data.length ?? 0) > 0;
  if (!hasPayments && req && !req.live_enabled) return <Setup hasTestPayment={false} />;

  const s = period.data ? summarize(period.data.data, now) : undefined;
  const cur = s?.currency ?? "usd";
  const money = (v: bigint) => formatFiat(v, cur);
  const attention = s ? s.reviews + s.delayed : 0;
  const attentionSub = s
    ? [s.reviews ? `${s.reviews} review${s.reviews === 1 ? "" : "s"}` : "", s.delayed ? `${s.delayed} delayed` : ""]
        .filter(Boolean)
        .join(" · ") || "Nothing to review"
    : undefined;
  const linkPath = app.registry.hasPath("/payment-links/new") ? "/payment-links/new" : undefined;
  const first = s?.days[0]?.start ?? periodStart;
  const range = `${formatDate(first).replace(/ \d{4}$/, "")} – ${formatDate(now)} · ${cur.toUpperCase()}`;

  return (
    <Page
      title="Your payments, in focus."
      subtitle={formatLongDate(now)}
      actions={
        linkPath ? (
          <a href={app.href(linkPath)} className={buttonClassName({ variant: "primary" })}>
            <span>Create payment link</span>
          </a>
        ) : undefined
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
      <StatRow
        loading={!s && !period.error}
        items={[
          {
            label: "Settled volume",
            value: s ? money(s.volume) : "—",
            sub:
              s && s.trendPermille !== null
                ? `${formatPermille(s.trendPermille, true)} vs previous week`
                : `Last ${PERIOD_DAYS} days`,
            trend:
              s && s.trendPermille !== null
                ? s.trendPermille > 0
                  ? "up"
                  : s.trendPermille < 0
                    ? "down"
                    : "neutral"
                : "neutral",
          },
          {
            label: "Successful payments",
            value: s ? s.succeeded.toLocaleString("en") : "—",
            sub:
              s?.completionPermille != null
                ? `${formatPermille(s.completionPermille)} completion`
                : "No payments this week",
          },
          { label: "Needs attention", value: s ? String(attention) : "—", sub: attentionSub },
        ]}
      />
      {s && attention > 0 ? (
        <Callout
          tone="warning"
          title={`${attention} payment${attention === 1 ? " needs" : "s need"} attention`}
          className="dash-narrow-only"
        >
          {attentionSub}
        </Callout>
      ) : null}
      <hr className="np-divider dash-wide-only" />
      <Section title="Payment volume" aside={range}>
        {s ? (
          <VolumeChart
            label={`Settled payment volume per day, last ${PERIOD_DAYS} days, ${cur.toUpperCase()}`}
            points={s.days.map((d) => ({
              label: formatDate(d.start).replace(/ \d{4}$/, ""),
              value: d.value,
              display: money(d.value),
            }))}
          />
        ) : (
          <div className="dash-chart dash-chart--loading" aria-hidden="true" />
        )}
        {s && s.otherCurrency > 0 ? (
          <p className="np-text-caption np-text-secondary">
            {s.otherCurrency} payment{s.otherCurrency === 1 ? "" : "s"} priced in another currency{" "}
            {s.otherCurrency === 1 ? "is" : "are"} not included.
          </p>
        ) : null}
        {period.data?.truncated ? (
          <p className="np-text-caption np-text-secondary">Based on your 500 most recent payments.</p>
        ) : null}
      </Section>
      <Section title="Recent payments" actions={<a href={app.href("/payments")}>View all payments</a>}>
        <PaymentsTable
          compact
          caption="Recent payments"
          intents={recent.data?.data ?? []}
          empty={`No ${app.mode} payments yet.`}
        />
      </Section>
      <p className="np-text-caption np-text-secondary">
        Funds settle directly to your chosen wallet. NearPay does not hold your balance.
      </p>
    </Page>
  );
}
