import { Refund, RefundNextAction } from "@nearpay-money/spec";
import { describe, expect, it, vi } from "vitest";
import {
  activity,
  canCancel,
  canOverrideRecipient,
  canPrepare,
  checkNextAction,
  intentSigner,
  NextActionMismatch,
  parseUnits,
  payingAttempt,
  refundableAmount,
  refundBadge,
  refundStage,
  type SignAndSend,
  type SignIntent,
  shouldPoll,
  unitsToInput,
  validateRefundAmount,
} from "./logic";
import { base58, erc191MultiPayload, evmTransfer, nep413MultiPayload, sendEvmTransfer } from "./signing";

const NOW = 1_800_000_000;
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NONCE = Buffer.alloc(32, 7).toString("base64");

function intentAction(over: Partial<SignIntent> = {}): SignIntent {
  const deadline = new Date((NOW + 600) * 1000).toISOString();
  const intents = [
    {
      intent: "transfer",
      receiver_id: "payer.near",
      tokens: { [USDC]: "2000000" },
      memo: "np1:4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
    },
  ];
  const message = { signer_id: "merchant.near", verifying_contract: "intents.near", deadline, nonce: NONCE, intents };
  return RefundNextAction.parse({
    type: "sign_intent",
    signer_id: "merchant.near",
    transfer: {
      receiver_id: "payer.near",
      token: USDC,
      amount: "2000000",
      memo: "np1:4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM",
    },
    standards: ["nep413"],
    nep413: {
      recipient: "intents.near",
      nonce: NONCE,
      message: JSON.stringify({ signer_id: "merchant.near", deadline, intents }),
    },
    payload: JSON.stringify(message),
    message,
    deadline: NOW + 600,
    display: "Transfer 2.000000 USDC to payer.near",
    ...over,
  }) as SignIntent;
}

function sendAction(over: Partial<SignAndSend> = {}): SignAndSend {
  return RefundNextAction.parse({
    type: "sign_and_send",
    chain: "eip155:8453",
    from: "0x52908400098527886E0F7030069857D2E4169EE7",
    to: "0x00000000000000000000000000000000000000aa",
    asset_id: USDC,
    token: { standard: "erc20", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
    symbol: "USDC",
    decimals: 6,
    amount: "2000000",
    memo: null,
    deadline: NOW + 600,
    display: "Send 2.000000 USDC on Base to 0x00…aa",
    ...over,
  }) as SignAndSend;
}

function refund(over: Record<string, unknown> = {}): Refund {
  return Refund.parse({
    id: "re_01jbz9k3m4n5p6q7r8s9t0v1w2",
    object: "refund",
    created: NOW - 100,
    livemode: true,
    status: "requires_action",
    payment_intent: "pi_01jbz9k3m4n5p6q7r8s9t0v1w2",
    payment_attempt: "pa_01jbz9k3m4n5p6q7r8s9t0v1w2",
    amount: "2000000",
    asset_id: USDC,
    decimals: 6,
    fee_mode: "payer_absorbs",
    reason: "requested_by_customer",
    method: "intents_transfer",
    recipient: { address: "payer.near", asset_id: USDC, chain: "near:mainnet", type: "intents", overridden: false },
    next_action: null,
    legs: [],
    amount_received: null,
    evidence: null,
    extra_amount_sent: "0",
    source: "dashboard",
    failure_code: null,
    succeeded_at: null,
    canceled_at: null,
    sequence: 1,
    metadata: {},
    ...over,
  });
}

const leg = (over: Record<string, unknown> = {}) => ({
  number: 1,
  status: "awaiting_signature",
  method: "intents_transfer",
  swap_type: null,
  amount: "2000000",
  amount_out_expected: null,
  deadline: NOW + 600,
  submitted_tx: null,
  duplicate: false,
  evidence: null,
  failure_code: null,
  created: NOW - 90,
  ...over,
});

describe("amounts (INV-5: string arithmetic)", () => {
  it("parses decimal text into base units", () => {
    expect(parseUnits("49", 6)).toEqual({ ok: true, value: "49000000" });
    expect(parseUnits("1,234.5", 2)).toEqual({ ok: true, value: "123450" });
    expect(parseUnits(".5", 6)).toEqual({ ok: true, value: "500000" });
    expect(parseUnits("0.000000000000000000000001", 24)).toEqual({ ok: true, value: "1" });
  });
  it("rejects bad input", () => {
    expect(parseUnits("", 6).ok).toBe(false);
    expect(parseUnits("-1", 6).ok).toBe(false);
    expect(parseUnits("1e5", 6).ok).toBe(false);
    expect(parseUnits(".", 6).ok).toBe(false);
    expect(parseUnits("1.1234567", 6)).toEqual({ ok: false, error: "Use at most 6 decimal places." });
    expect(parseUnits("1.5", 0)).toEqual({ ok: false, error: "This asset has no decimal places." });
  });
  it("formats base units for inputs", () => {
    expect(unitsToInput("49500000", 6)).toBe("49.50");
    expect(unitsToInput(2000017n, 6)).toBe("2.000017");
    expect(unitsToInput("7", 0)).toBe("7");
    expect(unitsToInput("5", 6)).toBe("0.000005");
  });
  it("validates against the refundable amount", () => {
    expect(validateRefundAmount("2", 6, 2_000_000n)).toEqual({ ok: true, value: "2000000" });
    expect(validateRefundAmount("2.000001", 6, 2_000_000n).ok).toBe(false);
    expect(validateRefundAmount("0", 6, 2_000_000n).ok).toBe(false);
  });
  it("computes refundable = settled − refunded − pending, floored at 0", () => {
    expect(refundableAmount({ amount_settled: "100", amount_refunded: "30", amount_refund_pending: "20" })).toBe(50n);
    expect(refundableAmount({ amount_settled: "100", amount_refunded: "100", amount_refund_pending: "5" })).toBe(0n);
    expect(refundableAmount({ amount_settled: "100", amount_refunded: "0" })).toBe(100n);
  });
  it("finds the paying attempt (not an overpayment)", () => {
    const a = (status: string, is_overpayment: boolean, id: string) => ({ status, is_overpayment, id }) as never;
    expect(payingAttempt({ attempts: [a("succeeded", true, "x"), a("succeeded", false, "y")] })?.id).toBe("y");
    expect(payingAttempt({ attempts: [a("failed", false, "x")] })).toBeUndefined();
  });
});

describe("next_action checks (sign exactly what the API returned)", () => {
  const r = refund();
  it("accepts a consistent sign_intent and sign_and_send", () => {
    expect(() => checkNextAction(r, intentAction(), NOW)).not.toThrow();
    expect(() => checkNextAction(r, sendAction(), NOW)).not.toThrow();
  });
  it("refuses an expired payload", () => {
    expect(() => checkNextAction(r, intentAction(), NOW + 601)).toThrow(NextActionMismatch);
  });
  it("refuses a summary that differs from the signed message", () => {
    const a = intentAction();
    expect(() => checkNextAction(r, { ...a, transfer: { ...a.transfer, receiver_id: "attacker.near" } }, NOW)).toThrow(
      /transfer differs/,
    );
    expect(() => checkNextAction(r, { ...a, transfer: { ...a.transfer, amount: "1" } }, NOW)).toThrow();
    expect(() => checkNextAction(r, { ...a, signer_id: "other.near" }, NOW)).toThrow(/signer/);
  });
  it("refuses a payload or NEP-413 message that differs from the parsed message", () => {
    const a = intentAction();
    const evil = JSON.parse(a.payload);
    evil.intents[0].receiver_id = "attacker.near";
    expect(() => checkNextAction(r, { ...a, payload: JSON.stringify(evil) }, NOW)).toThrow(/payload differs/);
    expect(() => checkNextAction(r, { ...a, payload: "not json" }, NOW)).toThrow(/not JSON/);
    expect(() =>
      checkNextAction(r, { ...a, nep413: { ...a.nep413, message: JSON.stringify({ signer_id: "x" }) } }, NOW),
    ).toThrow(/NEP-413/);
    expect(() =>
      checkNextAction(r, { ...a, nep413: { ...a.nep413, nonce: Buffer.alloc(32, 1).toString("base64") } }, NOW),
    ).toThrow(/nonce/);
  });
  it("refuses multiple intents, another asset, or a zero amount", () => {
    const a = intentAction();
    const two = { ...a.message, intents: [...a.message.intents, ...a.message.intents] };
    expect(() => checkNextAction(r, { ...a, message: two }, NOW)).toThrow();
    expect(() => checkNextAction(r, sendAction({ asset_id: `${USDC}x` as never }), NOW)).toThrow(/asset/);
    expect(() => checkNextAction(r, sendAction({ amount: "0" }), NOW)).toThrow(/zero/);
    expect(() => checkNextAction(r, sendAction({ to: sendAction().from }), NOW)).toThrow(/recipient/);
  });
  it("picks the signer standard", () => {
    expect(intentSigner(intentAction())).toBe("nep413");
    expect(
      intentSigner(intentAction({ signer_id: "0x52908400098527886e0f7030069857d2e4169ee7", standards: ["erc191"] })),
    ).toBe("erc191");
    expect(intentSigner(intentAction({ standards: ["raw_ed25519"] }))).toBeNull();
  });
});

describe("signed payloads are wrapped, never rebuilt", () => {
  it("base58 matches known vectors", () => {
    expect(base58(Uint8Array.from([0, 0, 1]))).toBe("112");
    expect(base58(new TextEncoder().encode("hello world"))).toBe("StV1DL6CwTryKyV");
  });
  it("NEP-413: keeps the action's arguments and converts a base64 signature", () => {
    const a = intentAction();
    const p = nep413MultiPayload(a, {
      accountId: "merchant.near",
      publicKey: "ed25519:2SBdAzviwkHZ4YkAdGqXTitBPqw752YyNhYtzBQiBb25",
      signature: Buffer.alloc(64, 9).toString("base64"),
    });
    expect(p).toMatchObject({ standard: "nep413", payload: a.nep413 });
    expect(p.standard === "nep413" && p.signature.startsWith("ed25519:")).toBe(true);
    // an ed25519:<b58> signature round-trips
    const again = nep413MultiPayload(a, {
      accountId: "merchant.near",
      publicKey: "ed25519:2SBdAzviwkHZ4YkAdGqXTitBPqw752YyNhYtzBQiBb25",
      signature: (p as { signature: string }).signature,
    });
    expect(again).toEqual(p);
  });
  it("NEP-413: refuses another account or a malformed signature", () => {
    const a = intentAction();
    const pk = "ed25519:2SBdAzviwkHZ4YkAdGqXTitBPqw752YyNhYtzBQiBb25";
    expect(() => nep413MultiPayload(a, { accountId: "x.near", publicKey: pk, signature: "AA==" })).toThrow();
    expect(() => nep413MultiPayload(a, { accountId: "merchant.near", publicKey: pk, signature: "AA==" })).toThrow();
    expect(() => nep413MultiPayload(a, { accountId: "merchant.near", publicKey: "bad", signature: "AA==" })).toThrow(
      /key/,
    );
  });
  it("ERC-191: exact payload string, v normalised to 0/1", () => {
    const a = intentAction({ signer_id: "0x52908400098527886e0f7030069857d2e4169ee7", standards: ["erc191"] });
    const p = erc191MultiPayload(a, `0x${"11".repeat(64)}1c`);
    expect(p).toMatchObject({ standard: "erc191", payload: a.payload });
    const p0 = erc191MultiPayload(a, `0x${"11".repeat(64)}01`);
    expect(p0.signature).toBe(p.signature);
    expect(() => erc191MultiPayload(a, `0x${"11".repeat(64)}05`)).toThrow();
    expect(() => erc191MultiPayload(a, "0x12")).toThrow();
  });
});

describe("EVM transfer for sign_and_send", () => {
  it("builds an ERC-20 transfer of exactly the amount to the deposit address", () => {
    const t = evmTransfer(sendAction());
    expect(t?.chainIdHex).toBe("0x2105");
    expect(t?.tx.to).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(t?.tx.data).toBe(
      `0xa9059cbb${"0".repeat(24)}00000000000000000000000000000000000000aa${(2_000_000).toString(16).padStart(64, "0")}`,
    );
  });
  it("builds a native transfer and rejects unsupported cases", () => {
    expect(evmTransfer(sendAction({ token: { standard: "native", address: null } }))?.tx.value).toBe("0x1e8480");
    expect(evmTransfer(sendAction({ chain: "near:mainnet" }))).toBeNull();
    expect(evmTransfer(sendAction({ memo: "123" }))).toBeNull();
    expect(evmTransfer(sendAction({ token: { standard: "spl", address: "x" } }))).toBeNull();
  });
  it("checks the account and chain before sending", async () => {
    const calls: string[] = [];
    let chain = "0x1";
    const provider = {
      request: vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
        calls.push(method);
        if (method === "eth_requestAccounts") return ["0x52908400098527886e0f7030069857d2e4169ee7"];
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") {
          chain = "0x2105";
          return null;
        }
        if (method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
        throw new Error(method);
      }),
    };
    await expect(sendEvmTransfer(provider, sendAction())).resolves.toBe(`0x${"ab".repeat(32)}`);
    expect(calls).toEqual([
      "eth_requestAccounts",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_chainId",
      "eth_sendTransaction",
    ]);
    const wrong = {
      request: async ({ method }: { method: string }) => (method === "eth_requestAccounts" ? ["0x1"] : null),
    };
    await expect(sendEvmTransfer(wrong, sendAction())).rejects.toThrow(/switch it to/);
  });
});

describe("refund state", () => {
  it("labels statuses with the design-system vocabulary", () => {
    expect(refundBadge("requires_action")).toBe("Not submitted");
    expect(refundBadge("succeeded")).toBe("Refunded");
    expect(refundBadge("brand_new")).toBe("brand new");
    expect(refundStage(refund({ status: "pending" })).title).toBe("Confirming");
    expect(refundStage(refund({ next_action: intentAction() })).title).toBe("Awaiting your wallet");
    expect(refundStage(refund({ legs: [leg({ status: "expired" })] })).title).toBe("Signing window closed");
  });
  it("derives allowed actions from the spec rules", () => {
    const open = refund({ next_action: intentAction(), legs: [leg()] });
    expect(canCancel(open)).toBe(true);
    expect(canPrepare(open)).toBe(false);
    expect(canOverrideRecipient(open)).toBe(true);
    const submitted = refund({ legs: [leg({ submitted_tx: "abcdefgh12" })] });
    expect(canCancel(submitted)).toBe(false);
    expect(canOverrideRecipient(submitted)).toBe(false);
    expect(shouldPoll(submitted)).toBe(true);
    const expired = refund({ legs: [leg({ status: "expired" })] });
    expect(canPrepare(expired)).toBe(true);
    expect(shouldPoll(expired)).toBe(false);
    expect(canPrepare(refund({ status: "failed" }))).toBe(true);
    expect(shouldPoll(refund())).toBe(true); // preparing
    expect(shouldPoll(refund({ status: "succeeded" }))).toBe(false);
  });
  it("builds the activity trail", () => {
    const rows = activity(refund({ status: "pending", legs: [leg({ submitted_tx: "abcdefgh12" })] }));
    expect(rows.map((r) => r.title)).toEqual([
      "Refund created",
      "Return prepared",
      "Refund authorized",
      "Refund complete",
    ]);
    expect(rows.at(-1)?.pendingLabel).toBe("Pending");
    const done = activity(
      refund({ status: "succeeded", succeeded_at: NOW, legs: [leg({ status: "succeeded", duplicate: true })] }),
    );
    expect(done.at(-1)).toMatchObject({ title: "Refund complete", at: NOW });
    expect(done.some((r) => r.title === "Extra return recorded")).toBe(true);
    expect(activity(refund({ status: "canceled", canceled_at: NOW })).at(-1)?.title).toBe("Refund canceled");
    expect(
      activity(refund({ status: "failed", legs: [leg({ status: "returned" })], failure_code: "x_y" })).map(
        (r) => r.title,
      ),
    ).toContain("Transfer returned");
  });
});
