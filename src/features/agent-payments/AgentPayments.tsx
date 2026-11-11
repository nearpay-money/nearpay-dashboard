/**
 * Agent payments (Figma "Agent payments", "Add a paid resource"): settled revenue, paid requests and
 * failures, paid resources (x402 resources grouped from real agent payments by `resource_url`), recent
 * activity with a kind filter and cursor pager, and the payment page. v1 has no resource registry in the
 * API: "Add paid resource" validates the inputs and produces the server code that issues the single-use
 * x402 requirements (`x402Requirements` via `@nearpay-money/node`) and settles before serving.
 */

import { buttonClassName, Callout, Input, Select, StatusBadge, Table } from "@nearpay-internal/ui";
import { type AgentPayment, getAgentPayment, listAgentPayments, listSettlementDestinations } from "@nearpay-money/spec";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useApp } from "../../app/context";
import type { ApiClient } from "../../lib/api";
import { explorerTxUrl } from "../../lib/explorer";
import { formatTime, formatWhen, shorten, shortId } from "../../lib/format";
import { useAsync, useCursorList } from "../../lib/hooks";
import { type AssetInfo, formatAsset, formatUnits, parseDecimal } from "../../lib/money";
import { statusOf } from "../../lib/status";
import { Empty, ErrorState, LoadingState, Page, Section, StatRow } from "../../ui/page";
import { Button, ErrorNote, Field, KeyValue, Mono, Pager } from "../../ui/ui";

const KINDS = ["x402", "checkout", "refund"] as const;
const WINDOW_DAYS = 7;

function TxLink({ hash }: { hash: string | null }) {
  if (!hash) return <span className="np-text-secondary">—</span>;
  const url = explorerTxUrl({ chain: "near:mainnet", tx_hash: hash });
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="dash-ext-link">
      {shorten(hash, 8)} ↗<span className="np-sr-only"> (opens a block explorer)</span>
    </a>
  ) : (
    <Mono>{hash}</Mono>
  );
}

function resourceName(url: string | null): string {
  if (!url) return "Checkout";
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

export interface ResourceRow {
  readonly url: string;
  readonly asset: string;
  readonly price: string;
  readonly requests: number;
  readonly revenue: bigint;
  readonly last: number;
}

/** Paid resources from x402 payments: requests and revenue (settled only), latest price per use. */
export function groupResources(payments: readonly AgentPayment[]): ResourceRow[] {
  const map = new Map<string, ResourceRow>();
  for (const p of payments) {
    if (p.kind !== "x402" || !p.resource_url) continue;
    const key = `${p.resource_url}|${p.asset_id}`;
    const r = map.get(key) ?? {
      url: p.resource_url,
      asset: p.asset_id,
      price: p.amount,
      requests: 0,
      revenue: 0n,
      last: 0,
    };
    const settled = p.status === "settled";
    map.set(key, {
      ...r,
      price: p.created >= r.last ? p.amount : r.price,
      last: Math.max(r.last, p.created),
      requests: r.requests + (settled ? 1 : 0),
      revenue: r.revenue + (settled ? BigInt(p.amount) : 0n),
    });
  }
  return [...map.values()].sort((a, b) => b.last - a.last);
}

async function loadWindow(api: ApiClient, since: number): Promise<AgentPayment[]> {
  const out: AgentPayment[] = [];
  let after: string | undefined;
  for (let i = 0; i < 5; i++) {
    const page = await api.call(listAgentPayments, {
      query: { limit: 100, "created[gte]": since, ...(after ? { starting_after: after } : {}) },
    });
    out.push(...page.data);
    const last = page.data[page.data.length - 1];
    if (!page.has_more || !last) break;
    after = last.id;
  }
  return out;
}

function sumByAsset(ps: readonly AgentPayment[], assets: ReadonlyMap<string, AssetInfo>): string {
  const sums = new Map<string, bigint>();
  for (const p of ps) if (p.status === "settled") sums.set(p.asset_id, (sums.get(p.asset_id) ?? 0n) + BigInt(p.amount));
  if (sums.size === 0) return formatAsset("0", [...assets.keys()][0] ?? "", assets);
  return [...sums.entries()].map(([a, v]) => formatAsset(v.toString(), a, assets)).join(" + ");
}

export function AgentPayments() {
  const app = useApp();
  const now = Math.floor(Date.now() / 1000);
  const [kind, setKind] = useState("");
  const win = useAsync(() => loadWindow(app.api, now - WINDOW_DAYS * 86_400), [app.api, app.mode]);
  const page = useCursorList<AgentPayment>(
    (after) =>
      app.api.call(listAgentPayments, {
        query: { limit: 20, ...(kind ? { kind } : {}), ...(after ? { starting_after: after } : {}) },
      }),
    [app.api, app.mode, kind],
    20,
  );
  const ps = win.data ?? [];
  const resources = useMemo(() => groupResources(ps), [ps]);
  const failed = ps.filter((p) => p.status === "failed").length;
  const rows = page.data?.data ?? [];
  const nothing = !page.loading && !kind && rows.length === 0 && !page.hasPrevious && !page.error;

  return (
    <Page
      title="Agent payments"
      subtitle="Get paid when agents use your services."
      actions={
        <Link to="/agent-payments/new" className={buttonClassName({ variant: "primary" })}>
          <span>Add paid resource</span>
        </Link>
      }
    >
      {win.error ? <ErrorNote error={win.error} onRetry={win.reload} /> : null}
      <StatRow
        loading={win.loading && !win.data}
        items={[
          { label: "Settled revenue", value: sumByAsset(ps, app.assets), sub: `Last ${WINDOW_DAYS} days` },
          {
            label: "Paid requests",
            value: ps.filter((p) => p.status === "settled").length.toLocaleString("en"),
            sub: "Verified payments",
          },
          {
            label: "Needs attention",
            value: String(failed),
            sub: failed === 1 ? "Failed settlement" : "Failed settlements",
          },
        ]}
      />
      <div data-testid="resources-table">
        <Table
          caption="Paid resources"
          loading={win.loading && !win.data}
          rows={resources}
          rowKey={(r) => `${r.url}|${r.asset}`}
          empty={`No paid resources were used in the last ${WINDOW_DAYS} days.`}
          columns={[
            {
              key: "res",
              header: "Resource",
              primary: true,
              cell: (r) => <span className="dash-break">{resourceName(r.url)}</span>,
            },
            {
              key: "price",
              header: "Price per use",
              numeric: true,
              cell: (r) => formatAsset(r.price, r.asset, app.assets),
            },
            {
              key: "req",
              header: "Requests",
              numeric: true,
              cell: (r) => r.requests.toLocaleString("en"),
              hideOnNarrow: true,
            },
            {
              key: "rev",
              header: "Revenue",
              numeric: true,
              cell: (r) => formatAsset(r.revenue.toString(), r.asset, app.assets),
            },
            {
              key: "status",
              header: "Status",
              hideOnNarrow: true,
              cell: (r) => (
                <StatusBadge tone={now - r.last < 86_400 ? "success" : "neutral"}>
                  {now - r.last < 86_400 ? "Active" : "Idle"}
                </StatusBadge>
              ),
            },
          ]}
        />
      </div>
      <Section
        title="Recent activity"
        actions={
          <div className="dash-inline-field">
            <Field label="Kind">
              {(id) => (
                <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">All kinds</option>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        }
      >
        {page.error ? <ErrorNote error={page.error} onRetry={page.reload} /> : null}
        {nothing ? (
          <Empty
            title={`No agent payments in ${app.mode} mode yet`}
            footnote={app.mode === "test" ? "Test mode · no real funds move" : undefined}
          >
            Agents pay for x402 resources and checkouts with payer-signed NEAR Intents transfers. They appear here once
            relayed.
          </Empty>
        ) : (
          <div data-testid="agent-payments-table">
            <Table
              caption="Agent payments"
              loading={page.loading && !page.data}
              rows={rows}
              rowKey={(p) => p.id}
              rowHref={(p) => app.href(`/agent-payments/${p.id}`)}
              empty={`No ${kind} agent payments.`}
              columns={[
                {
                  key: "amount",
                  header: "Paid",
                  primary: true,
                  numeric: true,
                  cell: (p) => formatAsset(p.amount, p.asset_id, app.assets),
                },
                { key: "res", header: "Resource", cell: (p) => resourceName(p.resource_url), hideOnNarrow: true },
                { key: "kind", header: "Kind", cell: (p) => p.kind, hideOnNarrow: true },
                {
                  key: "status",
                  header: "Status",
                  cell: (p) => {
                    const s = statusOf("agent_payment", p.status);
                    return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
                  },
                },
                { key: "payer", header: "Payer", cell: (p) => <Mono>{shorten(p.payer, 10)}</Mono>, hideOnNarrow: true },
                { key: "tx", header: "Transaction", cell: (p) => <TxLink hash={p.tx_hash} />, hideOnNarrow: true },
                { key: "at", header: "Created", cell: (p) => formatWhen(p.created), hideOnNarrow: true },
              ]}
            />
          </div>
        )}
        {page.data && !nothing ? (
          <Pager
            summary={rows.length ? `Showing ${page.offset}–${page.offset + rows.length - 1} payments` : undefined}
            hasMore={page.hasNext}
            canBack={page.hasPrevious}
            onNext={page.next}
            onBack={page.previous}
          />
        ) : null}
      </Section>
    </Page>
  );
}

export function AgentPaymentDetail({ id }: { id: string }) {
  const app = useApp();
  const ap = useAsync(() => app.api.call(getAgentPayment, { params: { id } }), [app.api, app.mode, id]);
  if (ap.loading && !ap.data) return <LoadingState what="Loading agent payment" />;
  const p = ap.data;
  if (!p) return <ErrorState title="Agent payment" error={ap.error} onRetry={ap.reload} />;
  const s = statusOf("agent_payment", p.status);
  return (
    <Page
      title={`Agent payment ${shortId(p.id)}`}
      subtitle={`${resourceName(p.resource_url)} · ${formatWhen(p.created)}`}
      status={<StatusBadge tone={s.tone}>{s.label}</StatusBadge>}
      back={{ label: "Agent payments", to: "/agent-payments" }}
    >
      <StatRow
        items={[
          { label: "Paid", value: formatAsset(p.amount, p.asset_id, app.assets), sub: p.kind },
          { label: "Payment fee", value: formatAsset(p.fee_amount, p.asset_id, app.assets), sub: "NearPay fee" },
          {
            label: "Settled",
            value: p.settled_at ? formatWhen(p.settled_at) : "Not yet",
            sub: p.block_height ? `Block ${p.block_height}` : undefined,
          },
        ]}
      />
      <Section title="Details" level={3}>
        <KeyValue
          rows={[
            ["Payment ID", <Mono key="id">{p.id}</Mono>],
            ["Payer", <Mono key="payer">{p.payer}</Mono>],
            ["Pay to", <Mono key="to">{p.pay_to}</Mono>],
            ["Binding", <Mono key="b">{p.binding}</Mono>],
            ["Resource", p.resource_url ?? "—"],
            ["Checkout session", p.checkout_session ? <Mono key="cs">{p.checkout_session}</Mono> : "—"],
            ["Transaction", <TxLink key="tx" hash={p.tx_hash} />],
            ["Settled at", formatTime(p.settled_at)],
            ...(p.error_reason ? ([["Error", p.error_reason]] as [string, string][]) : []),
          ]}
        />
      </Section>
    </Page>
  );
}

/** Server code for one paid resource (pure; unit-tested). Amount is exact base units. */
export function resourceSnippet(o: {
  name: string;
  url: string;
  amount: string;
  assetId: string;
  payTo: string;
  display: string;
}): string {
  return `import { NearPay } from "@nearpay-money/node";

const nearpay = new NearPay(process.env.NEARPAY_SECRET_KEY!); // or a restricted key with agentpay.facilitate

// ${o.name}: ${o.display} per request, settled to ${o.payTo}
const resource = { url: ${JSON.stringify(o.url)}, description: ${JSON.stringify(o.name)} };

export async function handle(req, res) {
  const header = req.headers["payment-signature"];
  if (!header) {
    // single-use requirements for this 402 response — never cache or share them
    const required = await nearpay.x402.requirements({
      resource,
      amount: ${JSON.stringify(o.amount)},
      asset_id: ${JSON.stringify(o.assetId)},
      pay_to: ${JSON.stringify(o.payTo)},
    });
    return res.status(402).json(required);
  }
  const paymentPayload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  // check paymentPayload.accepted equals the requirements you issued, then settle before serving
  const settled = await nearpay.x402.settle({
    x402Version: 2,
    paymentPayload,
    paymentRequirements: paymentPayload.accepted,
  });
  if (!settled.success) return res.status(402).json({ error: settled.errorReason });
  res.setHeader("payment-response", Buffer.from(JSON.stringify(settled)).toString("base64"));
  return serveResource(req, res); // deliver at most once per settlement (settled.replayed)
}
`;
}

export function AddResource() {
  const app = useApp();
  const dests = useAsync(
    () => app.api.call(listSettlementDestinations, { query: { limit: 100 } }),
    [app.api, app.mode],
  );
  const intents = (dests.data?.data ?? []).filter((d) => d.type === "intents_account" && d.status === "active");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [dest, setDest] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [snippet, setSnippet] = useState<string>();
  const [copied, setCopied] = useState(false);
  const chosen = intents.find((d) => d.id === dest) ?? (intents.length === 1 ? intents[0] : undefined);
  const asset = chosen ? app.assets.get(chosen.asset_id) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name the resource.";
    let parsedUrl: URL | undefined;
    try {
      parsedUrl = new URL(url.trim());
      if (parsedUrl.protocol !== "https:" && !(app.mode === "test" && parsedUrl.hostname === "localhost"))
        errs.url = "Use an https:// address.";
    } catch {
      errs.url = "Enter the full address, e.g. https://api.example.com/market-data.";
    }
    if (!chosen) errs.dest = "Choose an active NEAR Intents destination.";
    const amount = asset ? parseDecimal(price, asset.decimals) : null;
    if (!amount || amount === "0")
      errs.price = asset
        ? `Enter a price above 0 with at most ${asset.decimals} decimals.`
        : "Choose a destination first.";
    setErrors(errs);
    if (Object.keys(errs).length || !chosen || !amount || !asset || !parsedUrl) return;
    setSnippet(
      resourceSnippet({
        name: name.trim(),
        url: parsedUrl.toString(),
        amount,
        assetId: chosen.asset_id,
        payTo: chosen.address,
        display: `${formatUnits(amount, asset.decimals)} ${asset.symbol}`,
      }),
    );
  };

  return (
    <Page
      title="Add a paid resource"
      subtitle="Set a price and decide where agent payments arrive."
      back={{ label: "Agent payments", to: "/agent-payments" }}
      width="narrow"
    >
      <form className="dash-form np-card np-card--pad-md" onSubmit={submit} noValidate>
        <Field label="Resource name" error={errors.name}>
          {(id) => (
            <Input
              id={id}
              value={name}
              maxLength={500}
              onChange={(e) => setName(e.target.value)}
              placeholder="Market data lookup"
            />
          )}
        </Field>
        <Field label="Resource address" hint="The URL agents call." error={errors.url}>
          {(id) => (
            <Input
              id={id}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/market-data"
            />
          )}
        </Field>
        <Field
          label="Settlement destination"
          hint="x402 payments settle to an active NEAR Intents account."
          error={errors.dest}
        >
          {(id) => (
            <Select
              id={id}
              value={chosen?.id ?? dest}
              onChange={(e) => setDest(e.target.value)}
              disabled={dests.loading}
            >
              <option value="">
                {dests.loading
                  ? "Loading…"
                  : intents.length
                    ? "Choose a destination…"
                    : "No active Intents destination"}
              </option>
              {intents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} · {app.assets.get(d.asset_id)?.symbol ?? d.asset_id}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!dests.loading && intents.length === 0 ? (
          <Callout tone="warning" title="Add a NEAR Intents destination first">
            <Link to="/settlement/new">Add a destination</Link> that receives to a NEAR Intents account.
          </Callout>
        ) : null}
        <Field label={`Price per request${asset ? ` (${asset.symbol})` : ""}`} error={errors.price}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              numeric
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.01"
            />
          )}
        </Field>
        <Callout tone="info" title="Confirm payment before access">
          Serve a request only after its payment is verified and settled. Use test mode to review failed and repeated
          payments.
        </Callout>
        <ErrorNote error={dests.error} onRetry={dests.reload} />
        <Button type="submit" fullWidth>
          {app.mode === "test" ? "Create test resource" : "Create resource"}
        </Button>
      </form>
      {snippet ? (
        <Section title="Add this to your server" level={3}>
          <p className="np-text-secondary">
            NearPay doesn't host your resource. Your server answers unpaid requests with single-use payment requirements
            and settles each payment before serving. Requests appear under Agent payments as they settle.
          </p>
          <pre className="dash-json" data-testid="resource-snippet">
            {snippet}
          </pre>
          <div className="np-row">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                navigator.clipboard?.writeText(snippet).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {copied ? "Copied" : "Copy code"}
            </Button>
            <Link to="/developers?create=secret">Create a key</Link>
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
