import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/errors";
import {
  activePayoutWallets,
  linkStatus,
  optionalCount,
  optionalUrl,
  parsePrice,
  payoutWalletNeededText,
  payoutWalletState,
  priceText,
  shareUrl,
  usesText,
} from "./logic";
import { errorCopy, isPayoutWalletError } from "./parts";

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

describe("payout wallet needed before a link can be created", () => {
  const loaded = (data: { status: string }[]) => ({ loading: false, error: undefined, data: { data } });

  it("knows nothing while the list loads or when it failed, so the form does not block", () => {
    expect(payoutWalletState({ loading: true, error: undefined, data: undefined })).toBe("unknown");
    // a reload (mode switch) keeps the last data: still unknown until the new list arrives
    expect(payoutWalletState({ loading: true, error: undefined, data: { data: [] } })).toBe("unknown");
    expect(payoutWalletState({ loading: false, error: new Error("offline"), data: undefined })).toBe("unknown");
    expect(payoutWalletState({ loading: false, error: undefined, data: undefined })).toBe("unknown");
  });

  it("asks for a payout wallet when the loaded list has no active one", () => {
    expect(payoutWalletState(loaded([]))).toBe("none");
    expect(payoutWalletState(loaded([{ status: "pending_verification" }, { status: "disabled" }]))).toBe("none");
    expect(payoutWalletState(loaded([{ status: "disabled" }, { status: "active" }]))).toBe("ready");
  });

  it("offers only active wallets", () => {
    const list = loaded([{ status: "active" }, { status: "pending_approval" }, { status: "active" }]);
    expect(activePayoutWallets(list)).toHaveLength(2);
    expect(activePayoutWallets({ loading: true, error: undefined, data: undefined })).toEqual([]);
  });

  it("says it in plain words, per mode, without the word destination", () => {
    expect(payoutWalletNeededText("test")).toBe(
      "Payments from this link go straight to your payout wallet. This account has no active payout wallet in test mode yet.",
    );
    expect(payoutWalletNeededText("live")).toMatch(
      /in live mode yet\. If you've added one, finish verifying it first\.$/,
    );
    for (const mode of ["test", "live"] as const) expect(payoutWalletNeededText(mode)).not.toMatch(/destination/i);
  });

  it("maps the API's 409 destination_not_active to payout wallet wording", () => {
    const e = new ApiError({
      status: 409,
      type: "invalid_request_error",
      code: "destination_not_active",
      message: "The account has no active default settlement destination in this mode.",
      requestId: "req_01",
    });
    expect(isPayoutWalletError(e)).toBe(true);
    expect(errorCopy(e)).toBe(
      "No active payout wallet can receive this link's payments. Pick an active payout wallet, or add one first. Reference req_01.",
    );
    expect(errorCopy(e)).not.toMatch(/destination/i);
    expect(isPayoutWalletError(new Error("x"))).toBe(false);
    expect(isPayoutWalletError(undefined)).toBe(false);
  });
});
