import { describe, expect, it } from "vitest";
import { linkStatus, optionalCount, optionalUrl, parsePrice, priceText, shareUrl, usesText } from "./logic";

const USDC = { id: "nep141:usdc.near", meta: { symbol: "USDC", decimals: 6 } };

describe("payment link pricing (INV-5)", () => {
  it("parses fiat into integer minor units and assets into base-unit strings", () => {
    expect(parsePrice("49.00", "usd")).toEqual({ ok: true, pricing: { currency: "usd", amount: 4900 } });
    expect(parsePrice("1,000", "jpy")).toEqual({ ok: true, pricing: { currency: "jpy", amount: 1000 } });
    expect(parsePrice("2.5", "asset", USDC)).toEqual({
      ok: true,
      pricing: { currency: "asset", amount: "2500000", asset_id: "nep141:usdc.near" },
    });
  });
  it("rejects bad prices", () => {
    expect(parsePrice("", "usd").ok).toBe(false);
    expect(parsePrice("0", "usd").ok).toBe(false);
    expect(parsePrice("1.001", "usd").ok).toBe(false);
    expect(parsePrice("1", "asset").ok).toBe(false);
    expect(parsePrice("99999999999999999", "usd").ok).toBe(false);
  });
  it("formats prices", () => {
    const assets = new Map([["nep141:usdc.near", USDC.meta]]);
    expect(priceText({ amount: 4900, currency: "usd" }, assets)).toBe("$49.00");
    expect(priceText({ amount: "2500000", currency: "asset", asset_id: "nep141:usdc.near" }, assets)).toBe("2.50 USDC");
    expect(priceText({ amount: 100, currency: "chf" }, assets)).toBe("1.00 CHF");
  });
  it("derives status, usage and inputs", () => {
    expect(linkStatus({ active: true, uses: 1, max_uses: null }).label).toBe("Active");
    expect(linkStatus({ active: false, uses: 1, max_uses: null }).label).toBe("Disabled");
    expect(linkStatus({ active: true, uses: 3, max_uses: 3 }).detail).toBe("Usage limit reached");
    expect(usesText({ uses: 2, max_uses: 5 })).toBe("2 of 5");
    expect(optionalCount("")).toBeNull();
    expect(optionalCount("0")).toBeUndefined();
    expect(optionalCount("12")).toBe(12);
    expect(optionalUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(optionalUrl("http://a.example")).toBeUndefined();
    expect(optionalUrl("nope")).toBeUndefined();
    expect(shareUrl({ id: "plink_1", url: "https://pay.nearpay.money/l/plink_1" })).toBe(
      "https://pay.nearpay.money/l/plink_1",
    );
    expect(shareUrl({ id: "plink_1", url: "https://evil.example/l/plink_2" })).toBeNull();
  });
});
