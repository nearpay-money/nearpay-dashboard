import { describe, expect, it } from "vitest";
import { buildRegistry } from "../../src/app/registry";
import { groupResources, resourceSnippet } from "../../src/features/agent-payments/AgentPayments";
import {
  describeScopes,
  levelsFromScopes,
  scopeResources,
  scopesFromLevels,
} from "../../src/features/developers/scopes";
import { formatPermille, summarize } from "../../src/features/home/summary";
import { filtersFromSearch, queryFromFilters, searchFromFilters } from "../../src/features/payments/PaymentsList";
import { settingsCards } from "../../src/features/settings/Settings";
import { networkName, tokenOnNetwork } from "../../src/lib/chains";
import { csvCell, toCsv } from "../../src/lib/csv";
import { ApiError, friendlyError, StepUpCanceled } from "../../src/lib/errors";
import { dayKey, formatWhen, shortId } from "../../src/lib/format";
import { formatFiat, parseDecimal, toBigInt } from "../../src/lib/money";
import { humanStatus, statusOf } from "../../src/lib/status";
import { chartPoints } from "../../src/ui/VolumeChart";

describe("csv", () => {
  it("quotes, escapes and guards formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(12n)).toBe("12");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(false)).toBe("false");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(toCsv(["a", "b"], [["1", 2]])).toBe("a,b\r\n1,2\r\n");
  });
});

describe("money input", () => {
  it("parses decimals exactly into base units", () => {
    expect(parseDecimal("12.5", 2)).toBe("1250");
    expect(parseDecimal("1,234.56", 2)).toBe("123456");
    expect(parseDecimal(".5", 6)).toBe("500000");
    expect(parseDecimal("7", 0)).toBe("7");
    expect(parseDecimal("0.000001", 6)).toBe("1");
    expect(parseDecimal("1.001", 2)).toBeNull();
    expect(parseDecimal("-1", 2)).toBeNull();
    expect(parseDecimal("1e3", 2)).toBeNull();
    expect(parseDecimal("", 2)).toBeNull();
    expect(formatFiat(248600n, "usd")).toBe("$2,486.00");
    expect(formatFiat("5", "jpy")).toBe("¥5");
    expect(toBigInt(5)).toBe(5n);
    expect(toBigInt("7")).toBe(7n);
    expect(toBigInt(9n)).toBe(9n);
  });
});

describe("status vocabulary", () => {
  it("maps API values to design-system labels and tones", () => {
    expect(statusOf("payment", "succeeded")).toEqual({ label: "Paid", tone: "success" });
    expect(statusOf("payment", "requires_review")).toEqual({ label: "Review", tone: "warning" });
    expect(statusOf("kyb", "approved")).toEqual({ label: "Live", tone: "success" });
    expect(statusOf("kyb", "pending")).toEqual({ label: "Submitted", tone: "info" });
    expect(statusOf("destination", "cooling_off").label).toBe("Activating");
    // unknown open-enum values render as received
    expect(statusOf("delivery", "quarantined")).toEqual({ label: "Quarantined", tone: "neutral" });
    expect(statusOf("generic", "failed").tone).toBe("danger");
    expect(humanStatus("pending_review")).toBe("Pending review");
    expect(humanStatus("")).toBe("");
  });
});

describe("chains and format", () => {
  it("names networks", () => {
    expect(networkName("eip155:8453")).toBe("Base");
    expect(networkName("solana:abc")).toBe("Solana");
    expect(networkName("cosmos:x")).toBe("cosmos:x");
    expect(tokenOnNetwork("USDC", "near:mainnet")).toBe("USDC · NEAR");
  });
  it("formats times and ids", () => {
    const now = Math.floor(new Date(2026, 10, 7, 12, 0).getTime() / 1000);
    expect(formatWhen(now - 60, now)).toMatch(/^Today, 11:59$/);
    expect(formatWhen(now - 86_400, now)).toMatch(/^Yesterday, /);
    expect(formatWhen(now - 5 * 86_400, now)).toMatch(/^2 Nov, /);
    expect(formatWhen(now - 400 * 86_400, now)).toMatch(/2025, /);
    expect(formatWhen(null, now)).toBe("—");
    expect(dayKey(now)).toBe("2026-11-07");
    expect(shortId("pi_01jbz9k3m4n5p6q7r8s9t0v1w2")).toBe("pi_…v1w2");
    expect(shortId("short")).toBe("short");
  });
});

describe("friendly errors", () => {
  it("maps codes to copy and keeps the reference", () => {
    const e = new ApiError({
      status: 403,
      type: "permission_error",
      code: "approver_conflict",
      message: "m",
      requestId: "req_1",
    });
    const f = friendlyError(e);
    expect(f.title).toMatch(/Another owner or admin/);
    expect(f.reference).toBe("Reference req_1 · approver_conflict");
    expect(f.retryable).toBe(false);
    const g = friendlyError(new ApiError({ status: 503, type: "api_error", code: "weird", message: "down" }));
    expect(g.retryable).toBe(true);
    expect(g.reference).toBe("weird");
    expect(friendlyError(new ApiError({ status: 400, type: "x", code: "other", message: "Bad thing" })).title).toBe(
      "Bad thing",
    );
    expect(friendlyError(new StepUpCanceled()).title).toBe("Confirmation canceled.");
    expect(friendlyError(new TypeError("Failed to fetch")).retryable).toBe(true);
    expect(friendlyError(new Error("boom")).title).toBe("boom");
    expect(friendlyError("str").title).toBe("str");
  });
});

describe("feature registry", () => {
  const r = (name: string, pattern: string, stage?: number) => ({
    name,
    pattern,
    section: "settlement" as const,
    title: name,
    render: () => null,
    stage,
  });
  it("merges modules, orders static before params, fills nav slots in Figma order", () => {
    const reg = buildRegistry(
      [
        {
          id: "a",
          routes: [r("attest", "/settlement/:id"), r("bill", "/billing", 3)],
          nav: [{ slot: "settings", label: "Settings", href: "/settings" }],
        },
        {
          id: "b",
          routes: [r("new", "/settlement/new")],
          nav: [
            { slot: "overview", label: "Overview", href: "/" },
            { slot: "billing", label: "Billing", href: "/billing", stage: 3 },
          ],
          settingsCards: [
            { id: "z", title: "Z", description: "", href: "/z" },
            { id: "y", title: "Y", description: "", href: "/y", order: 1 },
          ],
        },
      ],
      2,
    );
    expect(reg.routes.map((x) => x.name)).toEqual(["new", "attest"]);
    expect(reg.nav.map((n) => n.slot)).toEqual(["overview", "settings"]);
    expect(reg.settingsCards.map((c) => c.id)).toEqual(["y", "z"]);
    expect(reg.hasPath("/settlement/sd_1")).toBe(true);
    expect(reg.hasPath("/settlement/sd_1/x?mode=live")).toBe(false);
    expect(reg.hasPath("/billing")).toBe(false);
    expect(() =>
      buildRegistry([
        { id: "a", routes: [r("x", "/a")] },
        { id: "b", routes: [r("x", "/b")] },
      ]),
    ).toThrow(/duplicate route name/);
    expect(() => buildRegistry([{ id: "a", routes: [r("x", "/a"), r("y", "/a")] }])).toThrow(/duplicate route pattern/);
  });
  it("settings cards: feature cards replace core ones, only existing pages", () => {
    const cards = settingsCards(
      [
        { id: "core:team", title: "Team", description: "", href: "/settings/team", order: 10 },
        { id: "team", title: "Team & approvals", description: "", href: "/settings/team", order: 10 },
        { id: "core:x", title: "X", description: "", href: "/settings/x" },
      ],
      (p) => p !== "/settings/x",
    );
    expect(cards.map((c) => c.id)).toEqual(["team"]);
  });
});

describe("payments filters", () => {
  it("round-trips the URL and builds the ADR-0018 query", () => {
    const f = filtersFromSearch("?status=succeeded&currency=usd&amin=10&amax=20.5&metadata[order_id]=42&period=7d");
    expect(f.status).toBe("succeeded");
    expect(f.metadata).toEqual([["order_id", "42"]]);
    const q = queryFromFilters(f, new Map(), 1_000_000);
    expect(q).toMatchObject({
      status: "succeeded",
      currency: "usd",
      "amount[gte]": "1000",
      "amount[lte]": "2050",
      "metadata[order_id]": "42",
      "created[gte]": String(1_000_000 - 7 * 86_400),
    });
    expect(searchFromFilters(f, "live")).toContain("mode=live");
    // amounts without a currency are not sent
    expect(queryFromFilters(filtersFromSearch("?amin=5&period=all"), new Map())).toEqual({});
    const a = queryFromFilters(
      filtersFromSearch("?currency=asset&asset_id=nep141:x&amin=1"),
      new Map([["nep141:x", { decimals: 6 }]]),
    );
    expect(a).toMatchObject({ asset_id: "nep141:x", "amount[gte]": "1000000" });
  });
});

describe("overview summary", () => {
  const now = Math.floor(new Date(2026, 10, 7, 12, 0).getTime() / 1000);
  const pi = (o: { status?: string; amount?: number; currency?: string; ago: number }) => ({
    status: (o.status ?? "succeeded") as "succeeded",
    amount: o.amount ?? 100,
    currency: o.currency ?? "usd",
    created: now - o.ago,
    succeeded_at: o.status && o.status !== "succeeded" ? null : now - o.ago,
  });
  it("sums volume in bigint, compares weeks, counts attention", () => {
    const s = summarize(
      [
        pi({ ago: 60, amount: 4900 }),
        pi({ ago: 86_400 * 2, amount: 100 }),
        pi({ ago: 86_400 * 9, amount: 2500 }),
        pi({ ago: 60, currency: "eur" }),
        pi({ ago: 120, status: "requires_review" }),
        pi({ ago: 3 * 3600, status: "processing" }),
        pi({ ago: 60, status: "processing" }),
      ],
      now,
    );
    expect(s.currency).toBe("usd");
    expect(s.volume).toBe(5000n);
    expect(s.previousVolume).toBe(2500n);
    expect(s.trendPermille).toBe(1000);
    expect(s.reviews).toBe(1);
    expect(s.delayed).toBe(1);
    expect(s.otherCurrency).toBe(1);
    expect(s.days).toHaveLength(7);
    expect(s.days[6]?.value).toBe(4900n);
    expect(s.total).toBe(6);
    expect(s.succeeded).toBe(3);
    expect(formatPermille(124, true)).toBe("+12.4%");
    expect(formatPermille(-5, true)).toBe("−0.5%");
    expect(formatPermille(0, true)).toBe("0.0%");
    expect(formatPermille(968)).toBe("96.8%");
    const empty = summarize([], now);
    expect(empty.trendPermille).toBeNull();
    expect(empty.completionPermille).toBeNull();
  });
  it("chart points scale to the max without floats in amounts", () => {
    expect(chartPoints([0n, 5n, 10n], 100, 100)).toEqual([
      [0, 100],
      [50, 54],
      [100, 8],
    ]);
    expect(chartPoints([])).toEqual([]);
    expect(chartPoints([0n, 0n], 10, 10)).toEqual([
      [0, 10],
      [10, 10],
    ]);
  });
});

describe("restricted key scopes", () => {
  it("builds the matrix from KEY_SCOPES and converts both ways", () => {
    const res = scopeResources();
    expect(res.find((r) => r.resource === "payment_intents")?.levels).toEqual(["read", "write"]);
    expect(res.find((r) => r.resource === "agentpay")?.levels).toEqual(["facilitate"]);
    expect(scopesFromLevels({ refunds: "write", events: "read", customers: "none" })).toEqual([
      "events.read",
      "refunds.write",
    ]);
    expect(levelsFromScopes(["refunds.read", "refunds.write", "events.read", "bad"])).toEqual({
      refunds: "write",
      events: "read",
    });
    expect(describeScopes(["payment_intents.read"])).toBe("Payments: read");
    expect(describeScopes(["a.read", "b.read", "c.read"])).toBe("3 permissions");
    expect(describeScopes([])).toBe("No permissions");
    expect(scopeResources(["x_y.read"])[0]?.label).toBe("X y");
  });
});

describe("agent resources", () => {
  it("groups x402 payments by resource and renders server code with exact amounts", () => {
    const base = {
      kind: "x402",
      asset_id: "a",
      resource_url: "https://x/r",
      status: "settled",
      amount: "10000",
      created: 1,
    };
    const rows = groupResources([
      base,
      { ...base, created: 2 },
      { ...base, status: "failed", created: 3 },
      { ...base, kind: "checkout" },
    ] as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requests).toBe(2);
    expect(rows[0]?.revenue).toBe(20000n);
    const code = resourceSnippet({
      name: "Lookup",
      url: "https://x/r",
      amount: "10000",
      assetId: "a",
      payTo: "m.near",
      display: "0.01 USDC",
    });
    expect(code).toContain('amount: "10000"');
    expect(code).toContain('pay_to: "m.near"');
    expect(code).toContain("nearpay.x402.settle");
  });
});
