/**
 * Payments list (Figma "Payments"): typed list filters (ADR-0018, spec 0.2.0 `listPaymentIntents`) kept in
 * the URL, cursor pager, client-side CSV export of the filtered list, and the first-payment empty state.
 */
import { IntentStatus, listPaymentIntents, type PaymentIntent } from "@nearpay/spec";
import { Button, CardIcon, useToast } from "@nearpay-internal/ui";
import { type FormEvent, useId, useMemo, useState } from "react";
import { useApp } from "../../app/context";
import { networkName } from "../../lib/chains";
import { downloadCsv, toCsv } from "../../lib/csv";
import { useCursorList, useMutation } from "../../lib/hooks";
import { currencyDigits, formatUnits, parseDecimal } from "../../lib/money";
import { statusOf } from "../../lib/status";
import { Empty, Page } from "../../ui/page";
import { ErrorNote, Pager } from "../../ui/ui";
import { PaymentsTable, settlementPlain } from "./shared";

const PAGE = 20;
const PERIODS = [
  ["7d", "Last 7 days", 7],
  ["30d", "Last 30 days", 30],
  ["90d", "Last 90 days", 90],
  ["all", "All time", 0],
] as const;
const SOURCES = [
  ["", "All payments"],
  ["checkout", "Checkout"],
  ["payment_link", "Payment links"],
  ["invoice", "Invoices"],
  ["api", "API"],
] as const;
export const CURRENCIES = ["usd", "eur", "gbp", "chf", "jpy", "cad", "aud"] as const;
/** Filters that live in the "More filters" panel. */
const MORE = ["amin", "amax", "asset_id", "settlement_asset_id", "customer", "payment_link", "checkout_session"];
const MAX_EXPORT = 1000;

export interface Filters {
  readonly period: string;
  readonly source: string;
  readonly status: string;
  readonly currency: string;
  readonly asset_id: string;
  readonly settlement_asset_id: string;
  readonly customer: string;
  readonly payment_link: string;
  readonly checkout_session: string;
  /** Amount bounds as typed (decimal, in the selected currency / asset). */
  readonly amin: string;
  readonly amax: string;
  readonly metadata: readonly (readonly [string, string])[];
}

export function filtersFromSearch(search: string): Filters {
  const sp = new URLSearchParams(search);
  const g = (k: string) => sp.get(k) ?? "";
  const metadata: [string, string][] = [];
  for (const [k, v] of sp) {
    const m = /^metadata\[([^[\]]{1,40})\]$/.exec(k);
    if (m?.[1]) metadata.push([m[1], v]);
  }
  return {
    period: g("period") || "30d",
    source: g("source"),
    status: g("status"),
    currency: g("currency"),
    asset_id: g("asset_id"),
    settlement_asset_id: g("settlement_asset_id"),
    customer: g("customer"),
    payment_link: g("payment_link"),
    checkout_session: g("checkout_session"),
    amin: g("amin"),
    amax: g("amax"),
    metadata,
  };
}

export function searchFromFilters(f: Filters, mode: string): string {
  const sp = new URLSearchParams();
  if (mode === "live") sp.set("mode", "live");
  if (f.period !== "30d") sp.set("period", f.period);
  for (const k of [
    "source",
    "status",
    "currency",
    "asset_id",
    "settlement_asset_id",
    "customer",
    "payment_link",
    "checkout_session",
    "amin",
    "amax",
  ] as const)
    if (f[k]) sp.set(k, f[k]);
  for (const [k, v] of f.metadata) sp.set(`metadata[${k}]`, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Decimals of the amount filter: the fiat currency's minor digits, or the pricing asset's decimals. */
function amountDecimals(f: Filters, assets: ReadonlyMap<string, { decimals: number }>): number | null {
  if (!f.currency) return null;
  if (f.currency === "asset") return f.asset_id ? (assets.get(f.asset_id)?.decimals ?? null) : null;
  return currencyDigits(f.currency);
}

/** The `listPaymentIntents` query for the filters (ADR-0018 notation; invalid amounts are left out). */
export function queryFromFilters(
  f: Filters,
  assets: ReadonlyMap<string, { decimals: number }>,
  nowSec = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const q: Record<string, string> = {};
  const days = PERIODS.find((p) => p[0] === f.period)?.[2] ?? 30;
  if (days > 0) q["created[gte]"] = String(nowSec - days * 86_400);
  if (f.source) q.source = f.source;
  if (f.status) q.status = f.status;
  if (f.currency) q.currency = f.currency;
  if (f.currency === "asset" && f.asset_id) q.asset_id = f.asset_id;
  if (f.settlement_asset_id) q.settlement_asset_id = f.settlement_asset_id;
  if (f.customer) q.customer = f.customer;
  if (f.payment_link) q.payment_link = f.payment_link;
  if (f.checkout_session) q.checkout_session = f.checkout_session;
  const d = amountDecimals(f, assets);
  if (d !== null) {
    const lo = f.amin ? parseDecimal(f.amin, d) : null;
    const hi = f.amax ? parseDecimal(f.amax, d) : null;
    if (lo !== null) q["amount[gte]"] = lo;
    if (hi !== null) q["amount[lte]"] = hi;
  }
  for (const [k, v] of f.metadata.slice(0, 10)) if (k && v) q[`metadata[${k}]`] = v;
  return q;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  const id = useId();
  return (
    <div className={`dash-filter${value ? " dash-filter--active" : ""}`}>
      <label htmlFor={id} className="np-sr-only">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="dash-filter__control">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

function MoreFilters({
  filters,
  onApply,
  onClose,
}: {
  filters: Filters;
  onApply: (f: Filters) => void;
  onClose(): void;
}) {
  const app = useApp();
  const [f, setF] = useState(filters);
  const [rows, setRows] = useState<[string, string][]>(
    filters.metadata.length ? filters.metadata.map(([k, v]) => [k, v]) : [["", ""]],
  );
  const decimals = amountDecimals(f, app.assets);
  const amountError =
    decimals !== null &&
    ((f.amin && parseDecimal(f.amin, decimals) === null) || (f.amax && parseDecimal(f.amax, decimals) === null))
      ? `Enter an amount with at most ${decimals} decimal places.`
      : undefined;
  const assets = [...app.assets.entries()].sort((a, b) => a[1].symbol.localeCompare(b[1].symbol));
  const set = (k: keyof Filters, v: string) => setF({ ...f, [k]: v });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (amountError) return;
    onApply({
      ...f,
      metadata: rows.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()] as const),
    });
  };
  const ids = { amin: useId(), amax: useId(), asset: useId(), sasset: useId(), cus: useId(), pl: useId(), cs: useId() };
  return (
    <form className="dash-more-filters" onSubmit={submit} aria-label="More filters" data-testid="more-filters">
      <fieldset className="dash-more-filters__group">
        <legend>Amount{f.currency ? ` (${f.currency === "asset" ? "asset" : f.currency.toUpperCase()})` : ""}</legend>
        {decimals === null ? (
          <p className="np-text-caption np-text-secondary">
            Choose a currency{f.currency === "asset" ? " and pricing asset" : ""} first, so amounts compare like with
            like.
          </p>
        ) : null}
        <div className="dash-more-filters__pair">
          <label htmlFor={ids.amin}>
            From
            <input
              id={ids.amin}
              className="dash-input"
              inputMode="decimal"
              disabled={decimals === null}
              value={f.amin}
              onChange={(e) => set("amin", e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label htmlFor={ids.amax}>
            To
            <input
              id={ids.amax}
              className="dash-input"
              inputMode="decimal"
              disabled={decimals === null}
              value={f.amax}
              onChange={(e) => set("amax", e.target.value)}
              placeholder="Any"
            />
          </label>
        </div>
        {amountError ? (
          <p className="np-field__error" role="alert">
            {amountError}
          </p>
        ) : null}
      </fieldset>
      <div className="dash-more-filters__grid">
        {f.currency === "asset" ? (
          <label htmlFor={ids.asset}>
            Pricing asset
            <select
              id={ids.asset}
              className="dash-input"
              value={f.asset_id}
              onChange={(e) => set("asset_id", e.target.value)}
            >
              <option value="">Any asset</option>
              {assets.map(([aid, a]) => (
                <option key={aid} value={aid}>
                  {a.symbol} · {networkName(a.chain ?? "")}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label htmlFor={ids.sasset}>
          Settlement asset
          <select
            id={ids.sasset}
            className="dash-input"
            value={f.settlement_asset_id}
            onChange={(e) => set("settlement_asset_id", e.target.value)}
          >
            <option value="">Any asset</option>
            {assets.map(([aid, a]) => (
              <option key={aid} value={aid}>
                {a.symbol} · {networkName(a.chain ?? "")}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.cus}>
          Customer ID
          <input
            id={ids.cus}
            className="dash-input"
            placeholder="cus_…"
            value={f.customer}
            onChange={(e) => set("customer", e.target.value.trim())}
            pattern="cus_[0-9a-z]+"
            title="A customer id starting with cus_"
          />
        </label>
        <label htmlFor={ids.pl}>
          Payment link ID
          <input
            id={ids.pl}
            className="dash-input"
            placeholder="plink_…"
            value={f.payment_link}
            onChange={(e) => set("payment_link", e.target.value.trim())}
            pattern="plink_[0-9a-z]+"
            title="A payment link id starting with plink_"
          />
        </label>
        <label htmlFor={ids.cs}>
          Checkout session ID
          <input
            id={ids.cs}
            className="dash-input"
            placeholder="cs_…"
            value={f.checkout_session}
            onChange={(e) => set("checkout_session", e.target.value.trim())}
            pattern="cs_[0-9a-z]+"
            title="A checkout session id starting with cs_"
          />
        </label>
      </div>
      <fieldset className="dash-more-filters__group">
        <legend>Metadata (exact match)</legend>
        {rows.map(([k, v], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: editable rows keep their position
          <div key={i} className="dash-more-filters__pair">
            <label>
              Key
              <input
                className="dash-input"
                maxLength={40}
                value={k}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
                placeholder="order_id"
              />
            </label>
            <label>
              Value
              <input
                className="dash-input"
                maxLength={500}
                value={v}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
              />
            </label>
          </div>
        ))}
        {rows.length < 10 ? (
          <button type="button" className="np-link-button" onClick={() => setRows([...rows, ["", ""]])}>
            Add metadata filter
          </button>
        ) : null}
      </fieldset>
      <div className="np-row">
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PaymentsList() {
  const app = useApp();
  const toast = useToast();
  const filters = useMemo(() => filtersFromSearch(app.location.search), [app.location.search]);
  const [moreOpen, setMoreOpen] = useState(false);
  const query = useMemo(() => queryFromFilters(filters, app.assets), [filters, app.assets]);
  const queryKey = JSON.stringify(query);
  const list = useCursorList<PaymentIntent>(
    (after) =>
      app.api.call(listPaymentIntents, {
        query: { limit: PAGE, ...query, ...(after ? { starting_after: after } : {}) },
      }),
    [app.api, app.mode, queryKey],
    PAGE,
  );
  const apply = (f: Filters) => app.navigate(`/payments${searchFromFilters(f, app.mode)}`, { replace: true });
  const update = (k: keyof Filters, v: string) => apply({ ...filters, [k]: v });
  const moreCount = MORE.filter((k) => filters[k as keyof Filters]).length + filters.metadata.length;
  const filtered =
    filters.period !== "30d" || Boolean(filters.source || filters.status || filters.currency) || moreCount > 0;

  const exporter = useMutation(async () => {
    const rows: PaymentIntent[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await app.api.call(listPaymentIntents, {
        query: { limit: 100, ...query, ...(after ? { starting_after: after } : {}) },
      });
      rows.push(...page.data);
      const last = page.data[page.data.length - 1];
      if (!page.has_more || !last || rows.length >= MAX_EXPORT) break;
      after = last.id;
    }
    const csv = toCsv(
      [
        "id",
        "created_utc",
        "status",
        "description",
        "amount",
        "currency",
        "pricing_asset",
        "source",
        "customer",
        "payment_link",
        "settled_amount",
        "settlement_asset",
        "settlement_network",
        "fee_bps",
        "fee_bearer",
        "livemode",
      ],
      rows.map((pi) => {
        const [settled, sym] = settlementPlain(pi, app.assets);
        const fiat = pi.currency !== "asset";
        const decimals = fiat ? currencyDigits(pi.currency) : (app.assets.get(pi.asset_id ?? "")?.decimals ?? 0);
        return [
          pi.id,
          new Date(pi.created * 1000).toISOString(),
          pi.status,
          pi.description,
          formatUnits(BigInt(pi.amount), decimals, fiat ? decimals : 0),
          pi.currency,
          pi.asset_id,
          pi.source,
          pi.customer ?? "",
          pi.payment_link ?? "",
          settled,
          sym,
          networkName(pi.destination.chain),
          pi.fee.total_bps,
          pi.fee.bearer,
          pi.livemode,
        ];
      }),
    );
    downloadCsv(`nearpay-payments-${app.mode}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.show({
      tone: "success",
      title: `Exported ${rows.length} payment${rows.length === 1 ? "" : "s"}`,
      body:
        rows.length >= MAX_EXPORT ? `The export stops at ${MAX_EXPORT} rows. Narrow the filters for more.` : undefined,
    });
    return rows.length;
  });

  const data = list.data?.data ?? [];
  const first = !filtered && !list.loading && !list.error && data.length === 0 && !list.hasPrevious;
  const linkPath = app.registry.hasPath("/payment-links/new") ? "/payment-links/new" : "/developers/start";

  if (first) {
    return (
      <Page title="Your first payment starts here." subtitle="Try checkout before accepting real funds.">
        <Empty
          icon={<CardIcon size={32} />}
          title={`No ${app.mode} payments yet`}
          action={
            <a href={app.href(linkPath)} className="np-button np-button--primary">
              <span>{app.mode === "test" ? "Create test payment link" : "Create payment link"}</span>
            </a>
          }
          footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
        >
          {app.mode === "test"
            ? "Create a test payment link, open checkout, and simulate a payment. You'll see the result here."
            : "Share a payment link or create checkout sessions from your server. Payments appear here as they arrive."}
        </Empty>
      </Page>
    );
  }

  const statusOptions: [string, string][] = [
    ["", "Status"],
    ...IntentStatus.options.map((s) => [s, statusOf("payment", s).label] as [string, string]),
  ];
  const currencyOptions: [string, string][] = [
    ["", "Currency"],
    ...CURRENCIES.map((c) => [c, c.toUpperCase()] as [string, string]),
    ["asset", "Priced in an asset"],
  ];
  return (
    <Page
      title="Payments"
      subtitle="Track every payment from checkout to settlement."
      actions={
        <Button
          variant="secondary"
          loading={exporter.busy}
          loadingText="Exporting…"
          onClick={() => void exporter.run()}
        >
          Export
        </Button>
      }
    >
      <fieldset className="dash-filters" aria-label="Filters">
        <FilterSelect
          label="Payment source"
          value={filters.source}
          onChange={(v) => update("source", v)}
          options={SOURCES}
        />
        <FilterSelect
          label="Period"
          value={filters.period}
          onChange={(v) => update("period", v)}
          options={PERIODS.map(([v, l]) => [v, l] as const)}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update("status", v)}
          options={statusOptions}
        />
        <FilterSelect
          label="Currency"
          value={filters.currency}
          onChange={(v) => update("currency", v)}
          options={currencyOptions}
        />
        <button
          type="button"
          className={`dash-filter dash-filter--button${moreCount ? " dash-filter--active" : ""}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          More filters{moreCount ? ` · ${moreCount}` : ""}
        </button>
        {filtered ? (
          <button
            type="button"
            className="np-link-button dash-filters__clear"
            onClick={() => app.navigate(app.href("/payments"), { replace: true })}
          >
            Clear filters
          </button>
        ) : null}
      </fieldset>
      {moreOpen ? (
        <MoreFilters
          filters={filters}
          onClose={() => setMoreOpen(false)}
          onApply={(f) => {
            setMoreOpen(false);
            apply(f);
          }}
        />
      ) : null}
      <ErrorNote error={exporter.error} />
      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : (
        <PaymentsTable
          intents={data}
          loading={list.loading && !list.data}
          caption="Payments"
          empty={
            <span>
              No payments
              {filters.status ? ` with status ${statusOf("payment", filters.status).label.toLowerCase()}` : ""} match
              these filters in {app.mode} mode.
            </span>
          }
          footer={
            list.data ? (
              <Pager
                summary={
                  data.length
                    ? `Showing ${list.offset}–${list.offset + data.length - 1} payments`
                    : `No payments in ${app.mode} mode.`
                }
                hasMore={list.hasNext}
                canBack={list.hasPrevious}
                onNext={list.next}
                onBack={list.previous}
              />
            ) : null
          }
        />
      )}
    </Page>
  );
}
