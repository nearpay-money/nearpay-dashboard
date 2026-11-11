/** Design v2 logic: top-bar jumper, Home numbers (chains, average), chart geometry, status tones, nav order. */
import { describe, expect, it } from "vitest";
import { jumpPages, jumpResults } from "../../src/app/jump-search";
import { buildRegistry, NAV_SLOTS, type RouteDef } from "../../src/app/registry";
import { chartSeries, greeting } from "../../src/features/home/Overview";
import { formatDuration, median, paidFromChain, summarize } from "../../src/features/home/summary";
import { paidWithText, payingAttempt } from "../../src/features/payments/shared";
import { statusOf } from "../../src/lib/status";
import { segmentHeights } from "../../src/ui/SourceChart";

const route = (name: string, pattern: string, title: string, extra: Partial<RouteDef> = {}): RouteDef => ({
  name,
  pattern,
  section: "payments",
  title,
  render: () => null,
  ...extra,
});

const registry = buildRegistry([
  {
    id: "t",
    nav: [
      { slot: "overview", label: "Home", href: "/" },
      { slot: "payments", label: "Payments", href: "/payments" },
      { slot: "settlement", label: "Payout wallets", href: "/settlement" },
    ],
    routes: [
      route("home", "/", "Home", { section: "overview" }),
      route("payments", "/payments", "Payments"),
      route("payment", "/payments/:id", "Payment"),
      route("settlement", "/settlement", "Payout wallets", { section: "settlement" }),
      route("settlement-new", "/settlement/new", "Add a payout wallet", { section: "settlement" }),
      route("team", "/settings/team", "Team", { section: "settings", roles: ["owner", "admin"] }),
      route("cli", "/cli/authorize", "Authorize CLI", { layout: "focus" }),
      route("customer", "/customers/:id", "Customer", { section: "customers" }),
    ],
  },
]);

describe("top-bar jumper", () => {
  it("lists static pages the role may open, named like the sidebar", () => {
    const owner = jumpPages(registry, "owner").map((p) => p.label);
    expect(owner).toEqual(
      expect.arrayContaining(["Home", "Payments", "Payout wallets", "Add a payout wallet", "Team"]),
    );
    expect(owner).not.toContain("Payment"); // parameter routes are objects, not pages
    expect(owner).not.toContain("Authorize CLI"); // focus pages are reached from the CLI only
    expect(jumpPages(registry, "developer").map((p) => p.label)).not.toContain("Team");
  });
  it("ranks prefix matches first and opens pasted IDs whose page exists", () => {
    const pages = jumpPages(registry, "owner");
    expect(jumpResults("pay", pages, registry).map((r) => r.label)[0]).toBe("Payments");
    expect(jumpResults("wallet", pages, registry).map((r) => r.label)).toEqual([
      "Payout wallets",
      "Add a payout wallet",
    ]);
    expect(jumpResults("  ", pages, registry)).toEqual([]);
    const pi = jumpResults("pi_01jbz9k3m4n5p6q7r8s9t00001", pages, registry)[0];
    expect(pi).toMatchObject({ path: "/payments/pi_01jbz9k3m4n5p6q7r8s9t00001", hint: "Open payment" });
    expect(jumpResults("cus_01jbz9k3m4n5p6q7", pages, registry)[0]?.path).toBe("/customers/cus_01jbz9k3m4n5p6q7");
    // checkout sessions open the filtered payments list (an existing filter)
    expect(jumpResults("cs_01jbz9k3m4n5", pages, registry)[0]?.path).toBe("/payments?checkout_session=cs_01jbz9k3m4n5");
    // no invoice route in this registry: the ID is not offered
    expect(jumpResults("in_01jbz9k3m4n5", pages, registry)).toEqual([]);
  });
});

describe("Home numbers", () => {
  const now = Math.floor(new Date(2026, 10, 7, 12, 0).getTime() / 1000);
  const attempt = (origin_chain: string, status = "succeeded", is_overpayment = false) => ({
    status: status as "succeeded",
    origin_chain,
    is_overpayment,
  });
  const pi = (amount: number, ago: number, attempts: ReturnType<typeof attempt>[], status = "succeeded") => ({
    status: status as "succeeded",
    amount,
    currency: "usd",
    created: now - ago,
    succeeded_at: status === "succeeded" ? now - ago : null,
    attempts,
  });

  it("attributes volume to the chain of the paying attempt, never an overpayment", () => {
    expect(paidFromChain({ attempts: [attempt("eip155:1", "succeeded", true), attempt("eip155:8453")] })).toBe(
      "eip155:8453",
    );
    expect(paidFromChain({ attempts: [attempt("near:mainnet", "expired_unpaid")] })).toBe("near:mainnet");
    expect(paidFromChain({ attempts: [] })).toBe("");
    const s = summarize(
      [
        pi(4900, 60, [attempt("eip155:8453")]),
        pi(1000, 120, [attempt("solana:mainnet")]),
        pi(2000, 86_400, [attempt("eip155:8453")]),
        pi(500, 180, [attempt("near:mainnet", "awaiting_deposit")], "requires_payment"),
      ],
      now,
    );
    expect(s.volume).toBe(7900n);
    expect(s.paidInCurrency).toBe(3);
    expect(s.average).toBe(2633n); // floor(7900 / 3), bigint
    expect(s.total).toBe(4);
    expect(s.chains).toEqual([
      { chain: "eip155:8453", value: 6900n },
      { chain: "solana:mainnet", value: 1000n },
    ]);
    expect(s.days[6]?.byChain.get("eip155:8453")).toBe(4900n);
    expect(s.days[5]?.byChain.get("eip155:8453")).toBe(2000n);
    expect(s.lastPaidAt).toBe(now - 60);
    expect(summarize([], now).average).toBeNull();
  });

  it("median time to paid: from the paying attempt's quote to succeeded_at, over the period", () => {
    const paid = (created: number, took: number, extra: Record<string, unknown> = {}) => ({
      status: "succeeded" as const,
      amount: 100,
      currency: "usd",
      created: now - created,
      succeeded_at: now - created + took,
      attempts: [
        { status: "succeeded" as const, origin_chain: "eip155:8453", is_overpayment: false, created: now - created },
      ],
      ...extra,
    });
    const s = summarize([paid(600, 4), paid(500, 9), paid(400, 6), paid(30 * 86_400, 1)], now);
    expect(s.medianToPaid).toBe(6); // the old payment (previous period window) is not counted
    expect(summarize([], now).medianToPaid).toBeNull();
    // no attempt timestamp (older servers): no median rather than a guess
    expect(summarize([{ ...paid(60, 5), attempts: [] }], now).medianToPaid).toBeNull();
    expect(median([5, 1, 3, 2])).toBe(2);
    expect(median([])).toBeNull();
    expect(formatDuration(4)).toBe("4 s");
    expect(formatDuration(95)).toBe("1 min 35 s");
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(720)).toBe("12 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(4000)).toBe("1 h 7 min");
  });

  it("charts up to three chains, else the top two and Other", () => {
    const base = summarize([], 0);
    const three = chartSeries({
      ...base,
      chains: [
        { chain: "eip155:8453", value: 3n },
        { chain: "solana:mainnet", value: 2n },
        { chain: "near:mainnet", value: 1n },
      ],
    });
    expect(three.series.map((x) => x.label)).toEqual(["Base", "Solana", "NEAR"]);
    const four = chartSeries({
      ...base,
      chains: [
        { chain: "eip155:8453", value: 4n },
        { chain: "solana:mainnet", value: 3n },
        { chain: "near:mainnet", value: 2n },
        { chain: "eip155:42161", value: 1n },
      ],
    });
    expect(four.series.map((x) => x.label)).toEqual(["Base", "Solana", "Other"]);
    expect(four.keyOf("eip155:42161")).toBe("other");
    expect(four.keyOf("near:mainnet")).toBe("other");
    expect(four.keyOf("eip155:8453")).toBe("eip155:8453");
  });

  it("greets by local time", () => {
    expect(greeting(new Date(2026, 10, 11, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 10, 11, 13))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 10, 11, 20))).toBe("Good evening");
  });
});

describe("chart geometry", () => {
  it("scales segment heights from bigint ratios; zero stays empty, tiny stays visible", () => {
    expect(segmentHeights([100n, 0n, 50n], 200n, 200)).toEqual([100, 0, 50]);
    expect(segmentHeights([1n], 1_000_000n, 200)).toEqual([4]);
    expect(segmentHeights([5n], 0n, 200)).toEqual([0]);
  });
});

describe("payments table v2", () => {
  const assets = new Map([["nep141:usdc.base", { symbol: "USDC", decimals: 6 }]]);
  const a = (status: string, chain: string, over = false) =>
    ({ status, origin_chain: chain, origin_asset_id: "nep141:usdc.base", is_overpayment: over }) as never;
  it("shows what the customer paid with, from the paying attempt", () => {
    expect(paidWithText({ attempts: [] }, assets)).toBe("Not chosen");
    expect(paidWithText({ attempts: [a("expired_unpaid", "eip155:1"), a("succeeded", "eip155:8453")] }, assets)).toBe(
      "USDC on Base",
    );
    expect(
      payingAttempt({ attempts: [a("succeeded", "eip155:1", true), a("succeeded", "eip155:8453")] }),
    ).toMatchObject({
      origin_chain: "eip155:8453",
    });
  });
});

describe("design v2 vocabulary", () => {
  it("uses the kit 0.5 tones: progress for moving payments, neutral for not paid", () => {
    expect(statusOf("payment", "processing")).toEqual({ label: "Confirming", tone: "progress" });
    expect(statusOf("payment", "requires_payment")).toEqual({ label: "Not paid", tone: "neutral" });
    expect(statusOf("payment", "requires_review")).toEqual({ label: "Review", tone: "warning" });
    expect(statusOf("attempt", "deposit_detected").tone).toBe("progress");
    expect(statusOf("kyb", "not_started").tone).toBe("neutral");
  });
  it("orders the sidebar like the landing showcase (its seven items first, then the rest)", () => {
    expect(NAV_SLOTS).toEqual([
      "overview",
      "payments",
      "payment-links",
      "subscriptions",
      "customers",
      "agent-payments",
      "settlement",
      "invoices",
      "developers",
      "business",
      "team",
      "settings",
    ]);
  });
});
