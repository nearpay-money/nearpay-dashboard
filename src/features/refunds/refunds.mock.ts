/**
 * E2E mock of the refund routes (plugs into `test/e2e/mock-api.ts` as a feature extension; responses are
 * validated against the spec by the mock). Test-only: never imported by the app.
 */
import { randomBytes } from "node:crypto";
import type { Role } from "@nearpay-money/spec";
import { NOW, newId, USDC_NEAR } from "../../../test/e2e/fixtures";

export interface MockCtx {
  readonly routeId: string;
  readonly mode: "test" | "live";
  readonly params: Record<string, string>;
  readonly query: Record<string, unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: bodies were validated against the route schema
  readonly body: any;
  readonly role: Role;
  readonly userId: string;
  /** Payment intents of the mock, by mode. */
  readonly intents: Record<"test" | "live", Array<Record<string, unknown>>>;
}
export type Reply = { status: number; body?: unknown };

const ok = (body: unknown, status = 200): Reply => ({ status, body });
const missing = (): Reply => ({
  status: 404,
  body: {
    error: {
      type: "invalid_request_error",
      code: "resource_missing",
      message: "No such refund.",
      request_id: newId("req"),
    },
  },
});
const list = (url: string, data: unknown[]) => ({ object: "list", data, has_more: false, url });

/** `signer` = Intents account of the merchant: `0x…` → ERC-191, else NEP-413. */
export class RefundsMock {
  readonly refunds = { test: [] as Record<string, unknown>[], live: [] as Record<string, unknown>[] };
  signer = "0x52908400098527886e0f7030069857d2e4169ee7";
  submitted: unknown[] = [];
  /**
   * `simulate_deposit` answers 202 at once; like the API, the refund changes only later: the next
   * `simulateLagReads` reads of the refund still return the old state (0 = changed at once).
   */
  simulateLagReads = 0;
  /** After the simulated transfer shows, the refund succeeds after this many more reads (0 = on the next read; null = stays pending). */
  settleAfterReads: number | null = null;
  private readonly lagging = new Map<string, number>();
  private readonly settling = new Map<string, number>();

  private applyTransfer(r: Record<string, unknown>) {
    const legs = r.legs as Record<string, unknown>[];
    Object.assign(r, {
      status: "pending",
      next_action: null,
      sequence: (r.sequence as number) + 1,
      legs: [{ ...legs[0], status: "submitted", submitted_tx: "9Fh3kT2mQx8LpR4vW7yZb1cDfGhJkN" }, ...legs.slice(1)],
    });
    if (this.settleAfterReads !== null) this.settling.set(r.id as string, this.settleAfterReads);
  }

  private settle(r: Record<string, unknown>) {
    const legs = r.legs as Record<string, unknown>[];
    Object.assign(r, {
      status: "succeeded",
      amount_received: r.amount,
      succeeded_at: NOW,
      sequence: (r.sequence as number) + 1,
      legs: [{ ...legs[0], status: "succeeded" }, ...legs.slice(1)],
      evidence: {
        chain: "near:mainnet",
        tx_hash: "9Fh3kT2mQx8LpR4vW7yZb1cDfGhJkN",
        block_ref: "223270900",
        recipient: "payer.near",
        asset_id: USDC_NEAR,
        amount: r.amount,
        finality: "final",
        tier: "A",
        source: "indexer",
        observed_at: new Date(NOW * 1000).toISOString(),
        explorer_url: null,
      },
    });
  }

  /** One read of a refund: counts down a lagging simulated transfer, then the settlement. */
  private read(r: Record<string, unknown>) {
    const id = r.id as string;
    const lag = this.lagging.get(id);
    if (lag !== undefined) {
      if (lag > 0) this.lagging.set(id, lag - 1);
      else {
        this.lagging.delete(id);
        this.applyTransfer(r);
      }
      return;
    }
    const left = this.settling.get(id);
    if (left === undefined) return;
    if (left > 0) this.settling.set(id, left - 1);
    else {
      this.settling.delete(id);
      this.settle(r);
    }
  }

  private action(amount: string) {
    const deadline = NOW + 900;
    const iso = new Date(deadline * 1000).toISOString();
    const nonce = randomBytes(32).toString("base64");
    const memo = "np1:4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
    const intents = [{ intent: "transfer", receiver_id: "payer.near", tokens: { [USDC_NEAR]: amount }, memo }];
    const message = { signer_id: this.signer, verifying_contract: "intents.near", deadline: iso, nonce, intents };
    return {
      type: "sign_intent",
      signer_id: this.signer,
      transfer: { receiver_id: "payer.near", token: USDC_NEAR, amount, memo },
      standards: this.signer.startsWith("0x") ? ["erc191"] : ["nep413"],
      nep413: {
        recipient: "intents.near",
        nonce,
        message: JSON.stringify({ signer_id: this.signer, deadline: iso, intents }),
      },
      payload: JSON.stringify(message),
      message,
      deadline,
      display: `Transfer ${amount} base units of USDC to payer.near`,
    };
  }

  handle(c: MockCtx): Reply | undefined {
    const all = this.refunds[c.mode];
    const find = () => all.find((r) => r.id === c.params.id);
    switch (c.routeId) {
      case "listRefunds":
        return ok(
          list(
            "/v1/refunds",
            all.filter(
              (r) =>
                (!c.query.payment_intent || r.payment_intent === c.query.payment_intent) &&
                (!c.query.status || r.status === c.query.status),
            ),
          ),
        );
      case "getRefund": {
        const r = find();
        if (!r) return missing();
        this.read(r);
        return ok(r);
      }
      case "createRefund": {
        const pi = c.intents[c.mode].find((p) => p.id === c.body.payment_intent);
        if (!pi) return missing();
        const amount = c.body.amount ?? pi.amount_settled;
        const attempt = (pi.attempts as { id: string; status: string }[]).find((a) => a.status === "succeeded");
        const r = {
          id: newId("re"),
          object: "refund",
          created: NOW,
          livemode: c.mode === "live",
          status: "requires_action",
          payment_intent: pi.id,
          payment_attempt: attempt?.id ?? newId("pa"),
          amount,
          asset_id: USDC_NEAR,
          decimals: 6,
          fee_mode: c.body.fee_mode,
          reason: c.body.reason ?? null,
          method: "intents_transfer",
          recipient: {
            address: "payer.near",
            asset_id: USDC_NEAR,
            chain: "near:mainnet",
            type: "intents",
            overridden: false,
          },
          next_action: this.action(amount),
          legs: [
            {
              number: 1,
              status: "awaiting_signature",
              method: "intents_transfer",
              swap_type: null,
              amount,
              amount_out_expected: null,
              deadline: NOW + 900,
              submitted_tx: null,
              duplicate: false,
              evidence: null,
              failure_code: null,
              created: NOW,
            },
          ],
          amount_received: null,
          evidence: null,
          extra_amount_sent: "0",
          source: "dashboard",
          failure_code: null,
          succeeded_at: null,
          canceled_at: null,
          sequence: 1,
          metadata: {},
        };
        all.unshift(r);
        pi.amount_refund_pending = amount;
        pi.refunds = [r.id];
        return ok(r, 201);
      }
      case "submitRefundTx":
      case "simulateRefundDeposit": {
        const r = find();
        if (!r) return missing();
        if (c.routeId === "submitRefundTx") {
          const a = r.next_action as { payload: string; nep413: unknown } | null;
          const s = c.body.signed_intent;
          if (
            s &&
            a &&
            (s.standard === "erc191" ? s.payload !== a.payload : JSON.stringify(s.payload) !== JSON.stringify(a.nep413))
          )
            return {
              status: 400,
              body: {
                error: {
                  type: "invalid_request_error",
                  code: "signed_intent_mismatch",
                  message: "mismatch",
                  request_id: newId("req"),
                },
              },
            };
          this.submitted.push(c.body);
        }
        if (c.routeId === "simulateRefundDeposit" && this.simulateLagReads > 0) {
          this.lagging.set(r.id as string, this.simulateLagReads);
          return { status: 202 };
        }
        this.applyTransfer(r);
        return c.routeId === "simulateRefundDeposit" ? { status: 202 } : ok(r);
      }
      case "cancelRefund": {
        const r = find();
        if (!r) return missing();
        Object.assign(r, {
          status: "canceled",
          next_action: null,
          canceled_at: NOW,
          sequence: (r.sequence as number) + 1,
        });
        return ok(r);
      }
      case "updateRefundRecipient": {
        const r = find();
        if (!r) return missing();
        Object.assign(r, {
          recipient: { ...(r.recipient as object), address: c.body.address, overridden: true },
          next_action: this.action(r.amount as string),
          sequence: (r.sequence as number) + 1,
        });
        return ok(r);
      }
      default:
        return undefined;
    }
  }

  /** A succeeded refund with evidence (for the detail screenshot). */
  seedSucceeded(mode: "test" | "live", pi: Record<string, unknown>) {
    const r = {
      id: newId("re"),
      object: "refund",
      created: NOW - 600,
      livemode: mode === "live",
      status: "succeeded",
      payment_intent: pi.id,
      payment_attempt: (pi.attempts as { id: string }[])[0]?.id,
      amount: "1000000",
      asset_id: USDC_NEAR,
      decimals: 6,
      fee_mode: "payer_absorbs",
      reason: "requested_by_customer",
      method: "intents_transfer",
      recipient: {
        address: "payer.near",
        asset_id: USDC_NEAR,
        chain: "near:mainnet",
        type: "intents",
        overridden: false,
      },
      next_action: null,
      legs: [
        {
          number: 1,
          status: "succeeded",
          method: "intents_transfer",
          swap_type: null,
          amount: "1000000",
          amount_out_expected: "1000000",
          deadline: NOW - 100,
          submitted_tx: "9Fh3kT2mQx8LpR4vW7yZb1cDfGhJkN",
          duplicate: false,
          evidence: null,
          failure_code: null,
          created: NOW - 590,
        },
      ],
      amount_received: "1000000",
      evidence: {
        chain: "near:mainnet",
        tx_hash: "9Fh3kT2mQx8LpR4vW7yZb1cDfGhJkN",
        block_ref: "223270900",
        recipient: "payer.near",
        asset_id: USDC_NEAR,
        amount: "1000000",
        finality: "final",
        tier: "A",
        source: "indexer",
        observed_at: new Date((NOW - 300) * 1000).toISOString(),
        explorer_url: null,
      },
      extra_amount_sent: "0",
      source: "dashboard",
      failure_code: null,
      succeeded_at: NOW - 300,
      canceled_at: null,
      sequence: 4,
      metadata: {},
    };
    this.refunds[mode].push(r);
    return r;
  }
}

/**
 * Plugs a feature mock into the shared `MockApi` without changing it: wraps its route dispatch (requests
 * are still checked — session, CSRF, roles, step-up, schemas — and responses validated against the spec).
 */
export function installFeatureMock(api: object, mock: { handle(c: MockCtx): Reply | undefined }): void {
  type Dispatch = (
    route: { id: string },
    params: Record<string, string>,
    query: Record<string, unknown>,
    body: unknown,
    h: Record<string, string>,
  ) => Reply;
  const a = api as unknown as {
    dispatch: Dispatch;
    role: Role;
    intents: MockCtx["intents"];
  };
  const base = a.dispatch.bind(api);
  a.dispatch = (route, params, query, body, h) =>
    mock.handle({
      routeId: route.id,
      mode: h["nearpay-mode"] === "live" ? "live" : "test",
      params,
      query,
      body,
      role: a.role,
      userId: "usr_01jbz9k3m4n5p6q7r8s9t0v1w2",
      intents: a.intents,
    }) ?? base(route, params, query, body, h);
}
