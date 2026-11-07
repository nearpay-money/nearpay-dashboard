import { describe, expect, it } from "vitest";
import { createBody, customerName, formOf, paidTotals, relativeDay, updateBody, validateCustomer } from "./logic";

describe("customers", () => {
  it("validates the form", () => {
    expect(validateCustomer({ name: "", email: "", description: "", wallets: [] }).name).toBeDefined();
    expect(validateCustomer({ name: "A", email: "bad", description: "", wallets: [] }).email).toBeDefined();
    expect(
      validateCustomer({
        name: "",
        email: "",
        description: "",
        wallets: [{ key: "1", chain: "near:mainnet", address: " " }],
      }).wallets,
    ).toBeDefined();
    expect(validateCustomer({ name: "A", email: "a@b.co", description: "", wallets: [] })).toEqual({});
  });
  it("builds create (omit empty) and update (null clears) bodies", () => {
    const f = {
      name: " Ada ",
      email: "",
      description: "",
      wallets: [{ key: "k", chain: "eip155:8453", address: " 0xab " }],
    };
    expect(createBody(f)).toEqual({ name: "Ada", wallets: [{ chain: "eip155:8453", address: "0xab" }] });
    expect(updateBody(f)).toEqual({
      name: "Ada",
      email: null,
      description: null,
      wallets: [{ chain: "eip155:8453", address: "0xab" }],
    });
    expect(formOf(undefined).wallets).toEqual([]);
  });
  it("sums paid payments per currency with bigint", () => {
    const t = paidTotals(
      [
        { status: "succeeded", amount: 4900, currency: "usd", asset_id: null, succeeded_at: 10 },
        { status: "succeeded", amount: 100, currency: "usd", asset_id: null, succeeded_at: 30 },
        { status: "requires_payment", amount: 999, currency: "usd", asset_id: null, succeeded_at: null },
        { status: "succeeded", amount: "2500000", currency: "asset", asset_id: "a", succeeded_at: 20 },
      ],
      new Map([["a", { symbol: "USDC", decimals: 6 }]]),
    );
    expect(t.parts).toEqual(["$50.00", "2.50 USDC"]);
    expect(t).toMatchObject({ count: 3, lastPaid: 30, partial: false });
    expect(customerName({ name: null, email: "x@y.z" })).toBe("x@y.z");
    expect(customerName({ name: null, email: null })).toBe("Unnamed customer");
  });
  it("labels relative days", () => {
    const now = new Date(2026, 10, 7, 12).getTime();
    expect(relativeDay(Math.floor(now / 1000), now)).toBe("Today");
    expect(relativeDay(Math.floor(now / 1000) - 86_400, now)).toBe("Yesterday");
    expect(relativeDay(null)).toBe("—");
  });
});
