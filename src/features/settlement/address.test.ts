import { describe, expect, it } from "vitest";
import { normalizeDestinationAddress } from "./address";

const CHECKSUMMED = "0x52908400098527886E0F7030069857D2E4169EE7";
const MIXED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const IMPLICIT = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
const SOLANA = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const BITCOIN = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

describe("payout wallet address normalisation", () => {
  it("lower-cases a 0x + 40 hex NEAR Intents account pasted in mixed case", () => {
    expect(normalizeDestinationAddress("intents_account", MIXED)).toEqual({
      value: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
      lowered: true,
    });
    expect(normalizeDestinationAddress("intents_account", CHECKSUMMED)).toEqual({
      value: "0x52908400098527886e0f7030069857d2e4169ee7",
      lowered: true,
    });
  });

  it("trims spaces around it and reports no change for a value that is already lower case", () => {
    expect(normalizeDestinationAddress("intents_account", `  ${MIXED}\n`).value).toBe(MIXED.toLowerCase());
    expect(normalizeDestinationAddress("intents_account", MIXED.toLowerCase())).toEqual({
      value: MIXED.toLowerCase(),
      lowered: false,
    });
  });

  it("leaves NEAR names and 64-hex implicit accounts as typed", () => {
    expect(normalizeDestinationAddress("intents_account", "merchant.near")).toEqual({
      value: "merchant.near",
      lowered: false,
    });
    expect(normalizeDestinationAddress("intents_account", IMPLICIT)).toEqual({ value: IMPLICIT, lowered: false });
    // not `0x` + 40 hex: never altered, the API decides
    expect(normalizeDestinationAddress("intents_account", "Merchant.NEAR").value).toBe("Merchant.NEAR");
    expect(normalizeDestinationAddress("intents_account", IMPLICIT.toUpperCase()).value).toBe(IMPLICIT.toUpperCase());
    expect(normalizeDestinationAddress("intents_account", `${MIXED}ab`).value).toBe(`${MIXED}ab`);
    expect(normalizeDestinationAddress("intents_account", MIXED.slice(0, -1)).value).toBe(MIXED.slice(0, -1));
    expect(normalizeDestinationAddress("intents_account", `0X${MIXED.slice(2)}`).value).toBe(`0X${MIXED.slice(2)}`);
  });

  it("never changes the letter case for the chain address type", () => {
    for (const a of [MIXED, CHECKSUMMED, SOLANA, BITCOIN, BITCOIN.toUpperCase(), "merchant.near"]) {
      expect(normalizeDestinationAddress("chain_address", a)).toEqual({ value: a, lowered: false });
    }
  });

  it("never changes case-sensitive addresses, whatever the type", () => {
    expect(normalizeDestinationAddress("intents_account", SOLANA).value).toBe(SOLANA);
    expect(normalizeDestinationAddress("intents_account", BITCOIN.toUpperCase()).value).toBe(BITCOIN.toUpperCase());
  });
});
