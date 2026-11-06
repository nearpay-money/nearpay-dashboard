import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createApiKey,
  createSettlementDestination,
  createWebhookEndpoint,
  getAccount,
  listPaymentIntents,
  revokeApiKey,
  startKyb,
} from "@nearpay/spec";
import { describe, expect, it } from "vitest";
import { cspNonce } from "../../src/lib/config";
import { explorerAddressUrl, explorerTxUrl } from "../../src/lib/explorer";
import { destinationFingerprint, normalizeAddress } from "../../src/lib/fingerprint";
import { formatIso, formatTime, humanize, relative, shorten } from "../../src/lib/format";
import { hrefFor, modeFromSearch, withMode } from "../../src/lib/mode";
import { assetLabel, currencyDigits, formatAsset, formatFiat, formatPrice, formatUnits } from "../../src/lib/money";
import { blockedReason, liveGate, roleAllows } from "../../src/lib/permissions";
import { matchPath } from "../../src/lib/router";
import { STORAGE_KEY, sessionStore } from "../../src/lib/session";

const require = createRequire(import.meta.url);

describe("money (integer formatting)", () => {
  it("formatUnits", () => {
    expect(formatUnits("2500000", 6)).toBe("2.5");
    expect(formatUnits("1", 6)).toBe("0.000001");
    expect(formatUnits(0n, 6)).toBe("0");
    expect(formatUnits("123456789000000000000000000", 24)).toBe("123.456789");
    expect(formatUnits(4999n, 2, 2)).toBe("49.99");
    expect(formatUnits(500n, 2, 2)).toBe("5.00");
    expect(formatUnits("1234567", 0)).toBe("1,234,567");
    expect(formatUnits(-150n, 2)).toBe("-1.5");
  });
  it("formatFiat / formatPrice / formatAsset", () => {
    const assets = new Map([["nep141:usdc.near", { symbol: "USDC", decimals: 6 }]]);
    expect(formatFiat(4999, "usd")).toBe("$49.99");
    expect(formatFiat(1000, "jpy")).toBe("¥1,000");
    expect(formatFiat(1050, "chf")).toBe("10.50 CHF");
    expect(currencyDigits("zzzz")).toBe(2);
    expect(formatPrice({ amount: 200, currency: "usd" }, assets)).toBe("$2.00");
    expect(formatPrice({ amount: "2000000", currency: "asset", asset_id: "nep141:usdc.near" }, assets)).toBe("2 USDC");
    expect(formatPrice({ amount: "5", currency: "asset", asset_id: null }, assets)).toBe("5 base units");
    expect(formatAsset("7", "nep141:x.near", assets)).toBe("7 base units");
    expect(assetLabel("nep141:usdc.near", assets)).toBe("USDC");
    expect(assetLabel("nep141:other.near", assets)).toBe("other.near");
  });
});

describe("fingerprint", () => {
  const v = JSON.parse(
    readFileSync(require.resolve("@nearpay/spec/test-vectors/destination-fingerprint.json"), "utf8"),
  ) as {
    cases: { chain: string; address_norm: string; asset_id: string; fingerprint: string }[];
  };
  it.each(v.cases.map((c) => [c.fingerprint, c] as const))("matches the spec vector %s", async (_f, c) => {
    expect(await destinationFingerprint(c.chain, c.address_norm, c.asset_id)).toBe(c.fingerprint);
  });
  it("normalises EVM addresses", async () => {
    const c = v.cases[1];
    if (!c) throw new Error("vector");
    expect(await destinationFingerprint(c.chain, c.address_norm.toUpperCase().replace("0X", "0x"), c.asset_id)).toBe(
      c.fingerprint,
    );
    expect(normalizeAddress("near:mainnet", "Merchant.near")).toBe("Merchant.near");
    expect(normalizeAddress("near:mainnet", "0xABCDEF0123456789abcdef0123456789ABCDEF01")).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });
});

describe("explorer links", () => {
  it("prefers the evidence URL, derives known chains, refuses unknown ones", () => {
    expect(explorerTxUrl({ chain: "near:mainnet", tx_hash: "abc", explorer_url: "https://x.example/tx/abc" })).toBe(
      "https://x.example/tx/abc",
    );
    expect(explorerTxUrl({ chain: "near:mainnet", tx_hash: "8xQ3", explorer_url: "javascript:alert(1)" })).toBe(
      "https://nearblocks.io/txns/8xQ3",
    );
    expect(explorerTxUrl({ chain: "eip155:8453", tx_hash: "0xab" })).toBe("https://basescan.org/tx/0xab");
    expect(explorerTxUrl({ chain: "sandbox:test", tx_hash: "abc" })).toBeNull();
    expect(explorerTxUrl({ chain: "near:mainnet", tx_hash: "a/b" })).toBeNull();
    expect(explorerAddressUrl("near:mainnet", "m.near")).toBe("https://nearblocks.io/address/m.near");
    expect(explorerAddressUrl("eip155:1", "0x52908400098527886e0f7030069857d2e4169ee7")).toBe(
      "https://etherscan.io/address/0x52908400098527886e0f7030069857d2e4169ee7",
    );
    expect(explorerAddressUrl("eip155:1", "not-an-address")).toBeNull();
    expect(explorerAddressUrl("solana:x", "abc")).toBeNull();
  });
});

describe("permissions", () => {
  it("roles come from the spec route table", () => {
    expect(roleAllows(createSettlementDestination, "owner")).toBe(true);
    expect(roleAllows(createSettlementDestination, "developer")).toBe(false);
    expect(roleAllows(createApiKey, "developer")).toBe(true);
    expect(roleAllows(createApiKey, undefined)).toBe(false);
    expect(roleAllows(getAccount, "viewer")).toBe(true);
    expect(roleAllows(listPaymentIntents, "viewer")).toBe(true);
    expect(roleAllows({ auth: ["secret_key"] }, "owner")).toBe(false);
  });
  it("gates live-only writes until live_enabled, never onboarding or safety actions", () => {
    expect(liveGate(createApiKey, "live", false)).toMatch(/not enabled/);
    expect(liveGate(createWebhookEndpoint, "live", undefined)).toMatch(/not enabled/);
    expect(liveGate({ id: "x", method: "POST", errors: ["account_not_live"] }, "live", false)).toMatch(/not enabled/);
    expect(liveGate(createApiKey, "live", true)).toBeNull();
    expect(liveGate(createApiKey, "test", false)).toBeNull();
    expect(liveGate(createSettlementDestination, "live", false)).toBeNull();
    expect(liveGate(revokeApiKey, "live", false)).toBeNull();
    expect(liveGate(startKyb, "live", false)).toBeNull();
    expect(liveGate(listPaymentIntents, "live", false)).toBeNull();
  });
  it("blockedReason combines both", () => {
    expect(blockedReason(createApiKey, { role: "viewer", mode: "test", liveEnabled: true })).toMatch(/viewer/);
    expect(blockedReason(createApiKey, { role: undefined, mode: "test", liveEnabled: true })).toMatch(/none/);
    expect(blockedReason(createApiKey, { role: "owner", mode: "live", liveEnabled: false })).toMatch(/Live mode/);
    expect(blockedReason(createApiKey, { role: "owner", mode: "live", liveEnabled: true })).toBeNull();
  });
});

describe("mode and router", () => {
  it("mode in the URL", () => {
    expect(modeFromSearch("")).toBe("test");
    expect(modeFromSearch("?mode=live")).toBe("live");
    expect(modeFromSearch("?mode=prod")).toBe("test");
    expect(withMode("?a=1", "live")).toBe("?a=1&mode=live");
    expect(withMode("?mode=live", "test")).toBe("");
    expect(hrefFor("/payments", "live")).toBe("/payments?mode=live");
    expect(hrefFor("/payments?status=x", "test")).toBe("/payments?status=x");
  });
  it("matchPath", () => {
    const routes = [
      { name: "home", pattern: "/" },
      { name: "payment", pattern: "/payments/:id" },
      { name: "attest", pattern: "/settlement/:id/attest" },
    ];
    expect(matchPath(routes, "/")).toEqual({ name: "home", params: {} });
    expect(matchPath(routes, "/payments/pi_1/")).toEqual({ name: "payment", params: { id: "pi_1" } });
    expect(matchPath(routes, "/settlement/sd%5F1/attest")).toEqual({ name: "attest", params: { id: "sd_1" } });
    expect(matchPath(routes, "/settlement/sd_1/other")).toBeNull();
    expect(matchPath(routes, "/payments/")).toBeNull();
    expect(matchPath(routes, "/nope")).toBeNull();
  });
});

describe("session store", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      m,
      s: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      },
    };
  };
  const session = {
    object: "dashboard_session" as const,
    user: { id: "usr_1", email: "a@b.co" },
    account: { id: "acct_1", display_name: "Acme" },
    role: "owner" as const,
    csrf_token: "c".repeat(43),
    expires_at: 2000,
  };
  it("saves, loads, expires and clears", () => {
    const { m, s } = mem();
    const st = sessionStore(s);
    expect(st.load(1000)).toBeNull();
    st.save(session as never);
    expect(st.load(1000)?.csrf_token).toBe(session.csrf_token);
    expect(st.load(2000)).toBeNull();
    expect(m.has(STORAGE_KEY)).toBe(false);
    st.save(session as never);
    st.clear();
    expect(st.load(1000)).toBeNull();
    m.set(STORAGE_KEY, "{not json");
    expect(st.load(1000)).toBeNull();
    m.set(STORAGE_KEY, JSON.stringify({ ...session, csrf_token: 1 }));
    expect(st.load(1000)).toBeNull();
    m.set(STORAGE_KEY, "42");
    expect(st.load(1000)).toBeNull();
  });
  it("works without storage", () => {
    const st = sessionStore(undefined);
    st.save(session as never);
    st.clear();
    expect(st.load()).toBeNull();
  });
});

describe("format and config", () => {
  it("formats times", () => {
    expect(formatTime(1793873400)).toBe("2026-11-05 10:10 UTC");
    expect(formatTime(null)).toBe("—");
    expect(formatIso("2026-11-05T10:50:00.000Z")).toBe("2026-11-05 10:50 UTC");
    expect(formatIso("garbage")).toBe("garbage");
    expect(formatIso(null)).toBe("—");
    expect(relative(1030, 1000)).toBe("in 30 s");
    expect(relative(1000, 1300)).toBe("5 min ago");
    expect(relative(1000 + 3 * 3600 + 20 * 60, 1000)).toBe("in 3 h 20 min");
    expect(shorten("abcdefghijklmnopqrstuvwxyz", 4)).toBe("abcd…wxyz");
    expect(shorten("short")).toBe("short");
    expect(humanize("requires_payment")).toBe("requires payment");
  });
  it("reads a well-formed CSP nonce only", () => {
    const doc = (content: string | null) => ({
      querySelector: () => (content === null ? null : { getAttribute: () => content }),
    });
    expect(cspNonce(doc("abc123") as never)).toBe("abc123");
    expect(cspNonce(doc('x"><script') as never)).toBeUndefined();
    expect(cspNonce(doc(null) as never)).toBeUndefined();
    expect(cspNonce(undefined)).toBeUndefined();
  });
});
