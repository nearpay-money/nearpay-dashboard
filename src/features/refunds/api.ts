/**
 * Refund API calls and hooks (spec 0.2.0 `refunds` module) over the dashboard's `ApiClient`.
 * Step-up (`updateRefundRecipient`) is handled by the client: `401 step_up_required` → dialog → one
 * replay with the same Idempotency-Key.
 */
import {
  cancelRefund,
  createRefund,
  getPaymentIntent,
  getRefund,
  listRefunds,
  type MultiPayload,
  type PaymentIntent,
  prepareRefund,
  type Refund,
  simulateRefundDeposit,
  submitRefundTx,
  updateRefundRecipient,
} from "@nearpay-money/spec";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/context";
import type { ApiClient } from "../../lib/api";
import { useAsync } from "../../lib/hooks";

export interface CreateRefundInput {
  readonly payment_intent: string;
  readonly payment_attempt?: string;
  readonly amount: string;
  readonly reason: "requested_by_customer" | "duplicate" | "fraudulent" | "overpayment" | "other";
  readonly fee_mode: "payer_absorbs" | "merchant_absorbs";
}

export function refundCalls(api: ApiClient) {
  return {
    create: (b: CreateRefundInput): Promise<Refund> =>
      api.call(createRefund, {
        body: {
          payment_intent: b.payment_intent,
          ...(b.payment_attempt ? { payment_attempt: b.payment_attempt } : {}),
          amount: b.amount,
          reason: b.reason,
          fee_mode: b.fee_mode,
        },
      }),
    get: (id: string): Promise<Refund> => api.call(getRefund, { params: { id } }),
    prepare: (id: string): Promise<Refund> => api.call(prepareRefund, { params: { id }, body: {} }),
    cancel: (id: string): Promise<Refund> => api.call(cancelRefund, { params: { id }, body: {} }),
    submitTx: (id: string, tx_hash: string, sender?: string): Promise<Refund> =>
      api.call(submitRefundTx, { params: { id }, body: sender ? { tx_hash, sender } : { tx_hash } }),
    submitSigned: (id: string, signed_intent: MultiPayload): Promise<Refund> =>
      api.call(submitRefundTx, { params: { id }, body: { signed_intent } }),
    overrideRecipient: (id: string, address: string, reason: string): Promise<Refund> =>
      api.call(updateRefundRecipient, { params: { id }, body: { address, reason } }),
    simulate: (id: string): Promise<void> =>
      api.call(simulateRefundDeposit, { params: { id }, body: {} }) as Promise<void>,
    intent: (id: string): Promise<PaymentIntent> => api.call(getPaymentIntent, { params: { id } }),
  };
}

export function useRefundCalls() {
  return refundCalls(useApp().api);
}

export function useRefund(id: string) {
  const app = useApp();
  return useAsync(() => app.api.call(getRefund, { params: { id } }), [id, app.mode, app.api]);
}

export function useIntent(id: string) {
  const app = useApp();
  return useAsync(() => app.api.call(getPaymentIntent, { params: { id } }), [id, app.mode, app.api]);
}

export const PAGE_SIZE = 20;

/** Cursor-paged refunds (newest first), optionally for one payment intent or status. */
export function useRefundList(filter: { payment_intent?: string; status?: string }) {
  const app = useApp();
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors[cursors.length - 1];
  const key = `${filter.payment_intent ?? ""}|${filter.status ?? ""}|${app.mode}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter or mode starts at the first page
  useEffect(() => setCursors([]), [key]);
  const state = useAsync(
    () =>
      app.api.call(listRefunds, {
        query: {
          limit: PAGE_SIZE,
          ...(after ? { starting_after: after } : {}),
          ...(filter.payment_intent ? { payment_intent: filter.payment_intent } : {}),
          ...(filter.status ? { status: filter.status } : {}),
        },
      }),
    [key, after, app.mode, app.api],
  );
  const next = useCallback(() => {
    const last = state.data?.data[state.data.data.length - 1];
    if (last) setCursors((c) => [...c, last.id]);
  }, [state.data]);
  const previous = useCallback(() => setCursors((c) => c.slice(0, -1)), []);
  const reset = useCallback(() => setCursors([]), []);
  return { ...state, page: cursors.length, next, previous, reset };
}
