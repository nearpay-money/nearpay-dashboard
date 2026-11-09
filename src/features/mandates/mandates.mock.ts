/**
 * E2E mock of the Stage 4 auto-debit routes (spec 0.4.0 `mandates`, via the placeholder `lib/spec-next`)
 * as a feature extension of test/e2e/mock-api.ts on top of the billing mock. Requests are still checked by
 * MockApi (session, CSRF, roles, idempotency keys, request schemas) and responses validated against the
 * route schemas. Mandates come from "the chain" only (seeded or simulated, billing §14 d1). Test-only.
 */
import { randomBytes } from "node:crypto";
import { API_VERSION } from "@nearpay/spec";
import { NOW, newId, USDC_NEAR } from "../../../test/e2e/fixtures";
import { AnyEvent, MANDATE_FUNDING_PAYER_NOTICE } from "../../lib/spec-next";
import type { BillingMock } from "../billing/billing.mock";
import { installFeatureMock, type MockCtx, type Reply } from "../customers/customers.mock";

type Mode = "test" | "live";
type Obj = Record<string, unknown>;

const ok = (body: unknown, status = 200): Reply => ({ status, body });
const fail = (status: number, code: string, type = "invalid_request_error"): Reply => ({
  status,
  body: { error: { type, code, message: code, request_id: newId("req") } },
});
const now = () => Math.floor(Date.now() / 1000);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const txHash = () => [...randomBytes(44)].map((b) => B58[b % 58]).join("");

export const MONTH = 2_629_746;
export const VAULT = { live: "v1.vault.nearpay.near", test: "vault-standin.sandbox.near" } as const;
export const USDC_TOKEN = USDC_NEAR.slice("nep141:".length);

export class MandatesMock {
  readonly mandates: Record<Mode, Obj[]> = { test: [], live: [] };
  /** `prepareMandate` answers this error code instead (e.g. `auto_debit_unavailable`). */
  prepareError?: string;
  /** The next `simulateMandateFunding` is refused by the sandbox vault with this error. */
  simulateRejection?: string;
  private readonly events: Record<Mode, Obj[]>;

  constructor(
    api: object,
    private readonly billing: BillingMock,
  ) {
    this.events = (api as { events: Record<Mode, Obj[]> }).events;
    billing.onRelease = (mode, id) => {
      const md = this.mandates[mode].find((x) => x.id === id);
      if (md) {
        md.collecting = false;
        md.next_collect_at = null;
        md.sequence = (md.sequence as number) + 1;
        this.emit(mode, "mandate.released", md);
      }
    };
    installFeatureMock(api, this);
  }

  /** A mandate as billing mirrors it from the vault (linked to `sub` unless overridden). */
  mandate(mode: Mode, sub: Obj, over: Obj = {}): Obj {
    const md: Obj = {
      id: newId("md"),
      object: "mandate",
      created: NOW - 32 * 86_400,
      livemode: mode === "live",
      status: "active",
      link_status: "linked",
      unlinked_reason: null,
      collecting: true,
      subscription: sub.id,
      customer: sub.customer,
      vault_contract: VAULT[mode],
      onchain_id: this.mandates.live.length + this.mandates.test.length + 7,
      payer: "alice.near",
      token: USDC_TOKEN,
      asset_id: USDC_NEAR,
      merchant_receiver: "acme.near",
      receiver_kind: "intents_account",
      settlement_destination: null,
      amount_per_period: "49000000",
      period_secs: MONTH,
      start_at: NOW - 32 * 86_400,
      max_periods: null,
      fee_bps: 100,
      collected_periods: 1,
      balance: "98000000",
      funded_periods: 2,
      next_collect_at: (sub.current_period_end as number) ?? NOW + 5 * 86_400,
      last_collection: null,
      collect_failures: 0,
      canceled: null,
      withdrawn: "0",
      ext_ref: sub.id,
      sequence: 3,
      ...over,
    };
    this.mandates[mode].unshift(md);
    if (md.link_status === "linked" && md.collecting) sub.mandate = md.id;
    return md;
  }

  /** A paid `auto_debit` invoice whose evidence is a vault collection of `md` (period `period`). */
  collection(mode: Mode, md: Obj, period: number, paidAt: number, short = false): Obj {
    const sub = this.billing.subscriptions[mode].find((s) => s.id === md.subscription) as Obj;
    const items = sub.items as { price: Obj; quantity: number }[];
    const tx = txHash();
    const receipt = txHash();
    const amount = BigInt(md.amount_per_period as string);
    const fee = (amount * BigInt(md.fee_bps as number)) / 10_000n;
    const share = short ? (amount - fee) / 2n : amount - fee;
    const inv = this.billing.invoice(mode, {
      created: paidAt - 60,
      customer: md.customer as string,
      subscription: md.subscription as string,
      billing_reason: period === 1 ? "subscription_create" : "subscription_cycle",
      lines: items.map((i) => ({ price: i.price.id as string, quantity: i.quantity })),
      status: short ? "open" : "paid",
      number: `ACME-${String(100 + period).padStart(4, "0")}`,
      finalized_at: paidAt - 60,
      due_date: paidAt + 7 * 86_400,
      paid_at: short ? null : paidAt,
      collection_method: "auto_debit",
      extra: {
        mandate: md.id,
        mandate_collection: short
          ? null
          : {
              mandate: md.id,
              period,
              token: md.asset_id,
              merchant_share: share.toString(),
              fee: fee.toString(),
              tx_hash: tx,
              receipt_id: receipt,
            },
      },
    });
    return {
      period,
      amount: (share + fee).toString(),
      merchant_share: share.toString(),
      fee: fee.toString(),
      short,
      invoice: inv.id,
      tx_hash: tx,
      receipt_id: receipt,
      collected_at: paidAt,
    };
  }

  private emit(mode: Mode, type: string, md: Obj) {
    const e = AnyEvent.parse({
      id: newId("evt"),
      object: "event",
      type,
      api_version: API_VERSION,
      created: now(),
      livemode: mode === "live",
      data: { object: md },
      request: { id: null, idempotency_key: null },
    }) as unknown as Obj;
    this.events[mode].unshift(e);
    return e;
  }

  private sub(mode: Mode, id: unknown): Obj | undefined {
    return this.billing.subscriptions[mode].find((s) => s.id === id);
  }

  private perPeriod(sub: Obj): string {
    const items = sub.items as { price: { unit_amount: number | string }; quantity: number }[];
    const cents = items.reduce((s, i) => s + BigInt(i.price.unit_amount) * BigInt(i.quantity), 0n);
    return (cents * 10_000n).toString(); // USD cents → USDC (6 decimals) at par
  }

  private funding(mode: Mode, sub: Obj, b: { periods?: number; token?: string; payer?: string }): Obj {
    const app = this.perPeriod(sub);
    const periods = b.periods ?? 3;
    const amount = (BigInt(app) * BigInt(periods)).toString();
    const token = b.token ?? USDC_TOKEN;
    const msg = JSON.stringify({
      action: "create",
      merchant_receiver: "acme.near",
      receiver_kind: "intents_account",
      amount_per_period: app,
      period_secs: MONTH,
      fee_bps: 100,
      ext_ref: sub.id,
    });
    return {
      object: "mandate_funding_instructions",
      livemode: mode === "live",
      subscription: sub.id,
      vault_contract: VAULT[mode],
      token,
      asset_id: `nep141:${token}`,
      amount,
      periods,
      amount_per_period: app,
      period_secs: MONTH,
      start_at: null,
      fee_bps: 100,
      merchant_receiver: "acme.near",
      receiver_kind: "intents_account",
      settlement_destination: newId("sd"),
      ext_ref: sub.id,
      msg,
      payer: b.payer ?? null,
      storage: { payer_registered: null, deposit: "12000000000000000000000" },
      payer_notice: MANDATE_FUNDING_PAYER_NOTICE,
      transactions: [
        {
          signer_id: null,
          receiver_id: VAULT[mode],
          actions: [
            {
              type: "FunctionCall",
              method_name: "storage_deposit",
              args: { registration_only: false },
              gas: "30000000000000",
              deposit: "12000000000000000000000",
            },
          ],
        },
        {
          signer_id: null,
          receiver_id: token,
          actions: [
            {
              type: "FunctionCall",
              method_name: "ft_transfer_call",
              args: { receiver_id: VAULT[mode], amount, msg },
              gas: "100000000000000",
              deposit: "1",
            },
          ],
        },
      ],
    };
  }

  private simulation(action: string, accepted: boolean, rejection: string | null, onchain: number | null): Obj {
    return {
      object: "mandate_simulation",
      action,
      tx_hash: txHash(),
      accepted,
      rejection,
      onchain_id: onchain,
      logs: accepted ? [`EVENT_JSON:{"standard":"nearpay_vault","version":"1.0.0","event":"${action}"}`] : [],
    };
  }

  handle(c: MockCtx): Reply | undefined {
    const m = c.mode;
    const b = c.body ?? {};
    const byId = () => this.mandates[m].find((x) => x.id === c.params.id);
    switch (c.routeId) {
      case "listMandates": {
        const q = c.query;
        const data = this.mandates[m].filter(
          (x) =>
            (!q.status || x.status === q.status) &&
            (!q.link_status || x.link_status === q.link_status) &&
            (!q.subscription || x.subscription === q.subscription) &&
            (!q.customer || x.customer === q.customer) &&
            (!q.payer || x.payer === q.payer),
        );
        return ok({ object: "list", data, has_more: false, url: "/v1/mandates" });
      }
      case "getMandate": {
        const md = byId();
        return md ? ok(md) : fail(404, "resource_missing");
      }
      case "prepareMandate": {
        const sub = this.sub(m, b.subscription);
        if (!sub) return fail(404, "resource_missing");
        if (this.prepareError) return fail(422, this.prepareError);
        if (sub.collection_method !== "auto_debit" || sub.status === "canceled") return fail(409, "state_conflict");
        return ok(this.funding(m, sub, b));
      }
      case "prepareMandateCancel": {
        const md = byId();
        if (!md) return fail(404, "resource_missing");
        if (md.status !== "active" && md.status !== "insufficient") return fail(409, "state_conflict");
        return ok({
          object: "mandate_cancel_instructions",
          mandate: md.id,
          transaction: {
            signer_id: md.merchant_receiver,
            receiver_id: md.vault_contract,
            actions: [
              {
                type: "FunctionCall",
                method_name: "cancel",
                args: { mandate_id: md.onchain_id },
                gas: "100000000000000",
                deposit: "1",
              },
            ],
          },
        });
      }
      case "simulateMandateFunding": {
        if (m === "live") return fail(400, "livemode_forbidden");
        const sub = this.sub(m, b.subscription);
        if (!sub) return fail(404, "resource_missing");
        if (sub.collection_method !== "auto_debit") return fail(409, "state_conflict");
        if (this.simulateRejection) {
          const r = this.simulateRejection;
          this.simulateRejection = undefined;
          return ok(this.simulation("fund", false, r, null));
        }
        const app = this.perPeriod(sub);
        const periods = b.periods ?? 3;
        const md = this.mandate(m, sub, {
          created: now(),
          payer: "sandbox-payer.near",
          amount_per_period: app,
          balance: (BigInt(app) * BigInt(periods)).toString(),
          funded_periods: periods,
          collected_periods: 0,
          start_at: now(),
          next_collect_at: sub.current_period_end,
          sequence: 1,
        });
        sub.sequence = (sub.sequence as number) + 1;
        this.emit(m, "mandate.activated", md);
        return ok(this.simulation("fund", true, null, md.onchain_id as number));
      }
      case "simulateMandatePayerAction": {
        if (m === "live") return fail(400, "livemode_forbidden");
        const md = byId();
        if (!md) return fail(404, "resource_missing");
        const active = md.status === "active" || md.status === "insufficient";
        const app = BigInt(md.amount_per_period as string);
        if (b.action === "top_up") {
          if (!active) return ok(this.simulation("top_up", false, "ERR_NOT_ACTIVE", md.onchain_id as number));
          const bal = BigInt(md.balance as string) + app * BigInt(b.periods ?? 1);
          md.balance = bal.toString();
          md.funded_periods = Number(bal / app);
          md.status = bal >= app ? "active" : "insufficient";
          md.sequence = (md.sequence as number) + 1;
          this.emit(m, "mandate.updated", md);
        } else if (b.action === "cancel") {
          if (!active) return ok(this.simulation("cancel", false, "ERR_NOT_ACTIVE", md.onchain_id as number));
          md.status = "canceled";
          md.collecting = false;
          md.next_collect_at = null;
          md.canceled = { by: md.payer, by_role: "payer", refunded: md.balance, canceled_at: now() };
          md.balance = "0";
          md.funded_periods = 0;
          md.sequence = (md.sequence as number) + 1;
          this.emit(m, "mandate.canceled", md);
        } else {
          if (active || md.balance === "0")
            return ok(this.simulation("withdraw", false, "ERR_NOTHING_TO_WITHDRAW", md.onchain_id as number));
          md.withdrawn = (BigInt(md.withdrawn as string) + BigInt(md.balance as string)).toString();
          md.balance = "0";
          md.sequence = (md.sequence as number) + 1;
          this.emit(m, "mandate.updated", md);
        }
        return ok(this.simulation(b.action, true, null, md.onchain_id as number));
      }
      default:
        return undefined;
    }
  }
}
