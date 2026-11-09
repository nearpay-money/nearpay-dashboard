/** Auto-debit logic (billing §6, §7.1, §14): eligibility, copy, periods, collections, transaction guards. */
import type { Invoice } from "@nearpay/spec";
import { describe, expect, it } from "vitest";
import { type Mandate, type MandateFundingInstructions, Mandate as MandateSchema } from "../../lib/spec-next";
import {
  autoDebitEligibility,
  bpsText,
  checkCancelTx,
  checkFundingTx,
  collectionRows,
  expectedShare,
  fundingInstructionsText,
  gasText,
  isEvmKeyedAccount,
  mandateStatusValue,
  nearCliCommand,
  periodText,
  pickLinked,
  startAtSeconds,
  tokenAmount,
  txLines,
  unlinkedReasonText,
  yoctoText,
} from "./logic";

const md = (over: Partial<Mandate> = {}): Mandate =>
  MandateSchema.parse({
    id: "md_01jbz9k3m4n5p6q7r8s9t0v1w2",
    object: "mandate",
    created: 1,
    livemode: true,
    status: "active",
    link_status: "linked",
    unlinked_reason: null,
    collecting: true,
    subscription: "sub_01jbz9k3m4n5p6q7r8s9t0v1w2",
    customer: "cus_01jbz9k3m4n5p6q7r8s9t0v1w2",
    vault_contract: "v1.vault.nearpay.near",
    onchain_id: 7,
    payer: "alice.near",
    token: "usdc.near",
    asset_id: "nep141:usdc.near",
    merchant_receiver: "acme.near",
    receiver_kind: "intents_account",
    settlement_destination: null,
    amount_per_period: "49000000",
    period_secs: 2_629_746,
    start_at: 1,
    max_periods: null,
    fee_bps: 100,
    collected_periods: 1,
    balance: "98000000",
    funded_periods: 2,
    next_collect_at: 2,
    last_collection: null,
    collect_failures: 0,
    canceled: null,
    withdrawn: "0",
    ext_ref: "sub_01jbz9k3m4n5p6q7r8s9t0v1w2",
    sequence: 1,
    ...over,
  });

const DESTS = [{ type: "intents_account", status: "active", asset_id: "nep141:usdc.near" }];

describe("eligibility (billing §14 d2)", () => {
  it("USD at par; asset prices need an allowed NEP-141 token; other fiat refused", () => {
    expect(autoDebitEligibility({ currency: "usd" }, DESTS, () => undefined)).toMatchObject({ kind: "eligible" });
    expect(
      autoDebitEligibility({ currency: "asset", asset_id: "nep141:wrap.near" }, DESTS, () => "wNEAR"),
    ).toMatchObject({
      kind: "check",
      tokens: "wNEAR",
    });
    expect(autoDebitEligibility({ currency: "asset", asset_id: "nep245:x" }, DESTS, () => undefined).kind).toBe(
      "ineligible",
    );
    const eur = autoDebitEligibility({ currency: "eur" }, DESTS, () => undefined);
    expect(eur.kind === "ineligible" && eur.reason).toMatch(/^EUR prices can't be auto-debited/);
    expect(autoDebitEligibility(undefined, DESTS, () => undefined).kind).toBe("ineligible");
  });
  it("needs an active NEAR Intents account (fix link)", () => {
    const r = autoDebitEligibility({ currency: "usd" }, [], () => undefined);
    expect(r).toMatchObject({ kind: "ineligible", fix: { to: "/settlement/new" } });
    expect(autoDebitEligibility({ currency: "asset", asset_id: "nep141:a.near" }, [], () => undefined).kind).toBe(
      "ineligible",
    );
    expect(autoDebitEligibility({ currency: "usd" }, undefined, () => undefined).kind).toBe("eligible");
  });
});

describe("copy and numbers", () => {
  it("unlinked reasons and status value", () => {
    expect(unlinkedReasonText("amount_mismatch")).toMatch(/amount per period/);
    expect(unlinkedReasonText(null)).toMatch(/don't match/);
    expect(unlinkedReasonText("new_reason")).toBe("Reason: new reason.");
    expect(mandateStatusValue(md({ link_status: "unlinked" }))).toBe("unlinked");
    expect(mandateStatusValue(md({ link_status: "unlinked", status: "canceled" }))).toBe("canceled");
    expect(mandateStatusValue(md({ status: "insufficient" }))).toBe("insufficient");
  });
  it("periods, fees, shares, tokens, gas", () => {
    expect(periodText(2_629_746)).toBe("month");
    expect(periodText(2 * 31_556_952)).toBe("2 years");
    expect(periodText(1_209_600)).toBe("2 weeks");
    expect(periodText(86_400 * 3)).toBe("3 days");
    expect(periodText(90_000)).toBe("25 hours");
    expect(bpsText(100)).toBe("1%");
    expect(bpsText(125)).toBe("1.25%");
    expect(bpsText(50)).toBe("0.5%");
    expect(expectedShare("49000000", 100)).toBe(48_510_000n);
    expect(tokenAmount("49000000", "USDC", 6)).toBe("49 USDC");
    expect(tokenAmount("5", undefined, undefined)).toBe("5 base units");
    expect(gasText("100000000000000")).toBe("100 Tgas");
    expect(yoctoText("1")).toBe("1 yoctoNEAR");
    expect(yoctoText("0")).toBe("none");
    expect(yoctoText("12000000000000000000000")).toBe("0.012 NEAR");
    expect(isEvmKeyedAccount("0x52908400098527886e0f7030069857d2e4169ee7")).toBe(true);
    expect(isEvmKeyedAccount("acme.near")).toBe(false);
    expect(startAtSeconds(null)).toBeNull();
    expect(startAtSeconds("1700000000000000000")).toBe(1_700_000_000);
  });
});

describe("collection history", () => {
  const inv = (id: string, period: number, paidAt: number, mandate = "md_01jbz9k3m4n5p6q7r8s9t0v1w2") =>
    ({
      id,
      status_transitions: { paid_at: paidAt },
      mandate_collection: {
        mandate,
        period,
        token: "nep141:usdc.near",
        merchant_share: "48510000",
        fee: "490000",
        tx_hash: "8hQ3XpDzWkYB6zEXfDzX9v2u8v5nJxQ3r7tKXk1n2bcd",
        receipt_id: "r1",
      },
    }) as unknown as Invoice;
  it("merges invoice evidence with the last (possibly short) collection, newest first", () => {
    const rows = collectionRows(
      md({
        last_collection: {
          period: 3,
          amount: "24745000",
          merchant_share: "24255000",
          fee: "490000",
          short: true,
          invoice: null,
          tx_hash: "9hQ3XpDzWkYB6zEXfDzX9v2u8v5nJxQ3r7tKXk1n2bcd",
          receipt_id: "r3",
          collected_at: 30,
        },
      }),
      [inv("in_01", 1, 10), inv("in_02", 2, 20), inv("in_x", 9, 90, "md_other")],
    );
    expect(rows.map((r) => [r.period, r.short, r.invoice])).toEqual([
      [3, true, null],
      [2, false, "in_02"],
      [1, false, "in_01"],
    ]);
  });
  it("prefers the linked mandate of the subscription", () => {
    const a = md({ id: "md_01jbz9k3m4n5p6q7r8s9t0aaaa" });
    const b = md({ id: "md_01jbz9k3m4n5p6q7r8s9t0bbbb", link_status: "unlinked" });
    expect(pickLinked({ mandate: a.id }, [b, a])?.id).toBe(a.id);
    expect(pickLinked({}, [b, a])?.id).toBe(a.id);
    expect(pickLinked({}, [b])).toBeUndefined();
  });
});

describe("transaction guards (wallet signing builds exactly the API payload)", () => {
  const cancel = {
    signer_id: "acme.near",
    receiver_id: "v1.vault.nearpay.near",
    actions: [
      {
        type: "FunctionCall" as const,
        method_name: "cancel",
        args: { mandate_id: 7 },
        gas: "100000000000000",
        deposit: "1",
      },
    ],
  };
  it("accepts exactly cancel({mandate_id}) on the vault", () => {
    const m = md();
    expect(checkCancelTx(m, cancel)).toBeNull();
    expect(checkCancelTx(m, { ...cancel, signer_id: null })).toBeNull();
    expect(checkCancelTx(m, { ...cancel, receiver_id: "evil.near" })).toMatch(/vault/);
    expect(checkCancelTx(m, { ...cancel, signer_id: "bob.near" })).toMatch(/signer/);
    const a0 = cancel.actions[0] as (typeof cancel.actions)[number];
    expect(checkCancelTx(m, { ...cancel, actions: [{ ...a0, method_name: "withdraw" }] })).toMatch(/isn't a cancel/);
    expect(checkCancelTx(m, { ...cancel, actions: [{ ...a0, args: { mandate_id: 8 } }] })).toMatch(/different mandate/);
    expect(checkCancelTx(m, { ...cancel, actions: [{ ...a0, args: { mandate_id: 7, x: 1 } }] })).toMatch(
      /different mandate/,
    );
    expect(checkCancelTx(m, { ...cancel, actions: [{ ...a0, deposit: "2" }] })).toMatch(/deposit/);
    expect(checkCancelTx(m, { ...cancel, actions: [a0, a0] })).toMatch(/unexpected actions/);
    expect(txLines(cancel)[0]).toMatchObject({ method: "cancel", gas: "100 Tgas", deposit: "1 yoctoNEAR" });
    expect(nearCliCommand(cancel, "acme.near")).toContain(
      "near contract call-function as-transaction v1.vault.nearpay.near cancel json-args '{\"mandate_id\":7}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as acme.near",
    );
  });
  const funding = (): MandateFundingInstructions => ({
    object: "mandate_funding_instructions",
    livemode: true,
    subscription: "sub_01jbz9k3m4n5p6q7r8s9t0v1w2",
    vault_contract: "v1.vault.nearpay.near",
    token: "usdc.near",
    asset_id: "nep141:usdc.near",
    amount: "147000000",
    periods: 3,
    amount_per_period: "49000000",
    period_secs: 2_629_746,
    start_at: null,
    fee_bps: 100,
    merchant_receiver: "acme.near",
    receiver_kind: "intents_account",
    settlement_destination: "sd_01jbz9k3m4n5p6q7r8s9t0v1w2",
    ext_ref: "sub_01jbz9k3m4n5p6q7r8s9t0v1w2",
    msg: '{"action":"create"}',
    payer: null,
    storage: { payer_registered: null, deposit: "12000000000000000000000" },
    payer_notice: "Sign from your own NEAR account.",
    transactions: [
      {
        signer_id: null,
        receiver_id: "v1.vault.nearpay.near",
        actions: [
          {
            type: "FunctionCall",
            method_name: "storage_deposit",
            args: {},
            gas: "30000000000000",
            deposit: "12000000000000000000000",
          },
        ],
      },
      {
        signer_id: null,
        receiver_id: "usdc.near",
        actions: [
          {
            type: "FunctionCall",
            method_name: "ft_transfer_call",
            args: { receiver_id: "v1.vault.nearpay.near", amount: "147000000", msg: '{"action":"create"}' },
            gas: "100000000000000",
            deposit: "1",
          },
        ],
      },
    ],
  });
  it("funding: ft_transfer_call on the token to the vault with the stated amount and msg", () => {
    const f = funding();
    expect(checkFundingTx(f)).toBeNull();
    const ft = f.transactions[1] as MandateFundingInstructions["transactions"][number];
    const a = ft.actions[0] as (typeof ft.actions)[number];
    const withLast = (tx: typeof ft) => ({ ...f, transactions: [f.transactions[0] as typeof ft, tx] });
    expect(checkFundingTx(withLast({ ...ft, receiver_id: "evil.near" }))).toMatch(/token/);
    expect(checkFundingTx(withLast({ ...ft, actions: [{ ...a, args: { ...a.args, amount: "1" } }] }))).toMatch(
      /amount/,
    );
    expect(checkFundingTx(withLast({ ...ft, actions: [{ ...a, deposit: "5" }] }))).toMatch(/deposit/);
    expect(checkFundingTx({ ...f, transactions: [{ ...ft, actions: [a, a] }] })).toMatch(/incomplete/);
    expect(checkFundingTx({ ...f, transactions: [{ ...ft, receiver_id: "x.near" }, ft] })).toMatch(/storage/);
    expect(checkFundingTx({ ...f, transactions: [ft] })).toBeNull();
  });
  it("instructions text for the customer", () => {
    const t = fundingInstructionsText(funding(), {
      merchant: "Acme Coffee",
      symbol: "USDC",
      decimals: 6,
      invoiceUrl: "https://pay.nearpay.money/i/in_1#s",
    });
    expect(t).toContain("with 147 USDC (3 × 49 USDC)");
    expect(t).toContain("at most 49 USDC every month");
    expect(t).toContain("Sign from your own NEAR account.");
    expect(t).toContain('choose "Set up auto-debit": https://pay.nearpay.money/i/in_1#s');
    expect(t).toContain("2. usdc.near → ft_transfer_call(");
  });
});
