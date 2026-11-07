/** Customer API calls and hooks (spec 0.2.0 `customers`), plus per-customer paid totals. */
import {
  type Customer,
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  listPaymentIntents,
  updateCustomer,
} from "@nearpay/spec";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../app/context";
import { useAsync } from "../../lib/hooks";
import { type CustomerForm, createBody, paidTotals, type Totals, updateBody } from "./logic";

export const PAGE_SIZE = 20;
/** Payments summed per customer for the list's "Total paid" (first page; spec has no totals field). */
export const TOTALS_SCAN = 100;

export function useCustomerCalls() {
  const { api } = useApp();
  return {
    create: (f: CustomerForm): Promise<Customer> => api.call(createCustomer, { body: createBody(f) }),
    update: (id: string, f: CustomerForm): Promise<Customer> =>
      api.call(updateCustomer, { params: { id }, body: updateBody(f) }),
    remove: (id: string) => api.call(deleteCustomer, { params: { id } }),
  };
}

export function useCustomer(id: string) {
  const app = useApp();
  return useAsync(() => app.api.call(getCustomer, { params: { id } }), [id, app.mode, app.api]);
}

export function useCustomerList(email: string) {
  const app = useApp();
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter or mode starts at the first page
  useEffect(() => setCursors([]), [email, app.mode]);
  const state = useAsync(
    () =>
      app.api.call(listCustomers, {
        query: { limit: PAGE_SIZE, ...(after ? { starting_after: after } : {}), ...(email ? { email } : {}) },
      }),
    [email, after, app.mode, app.api],
  );
  const next = useCallback(() => {
    const last = state.data?.data.at(-1);
    if (last) setCursors((c) => [...c, last.id]);
  }, [state.data]);
  return { ...state, page: cursors.length, next, previous: () => setCursors((c) => c.slice(0, -1)) };
}

/**
 * Paid totals for the customers on screen: one `listPaymentIntents?customer=…&status=succeeded` per
 * customer, at most 4 in flight. Failures leave that row's totals unknown.
 */
export function useTotals(ids: readonly string[]): ReadonlyMap<string, Totals | "error"> {
  const app = useApp();
  const [totals, setTotals] = useState<ReadonlyMap<string, Totals | "error">>(new Map());
  const key = ids.join(",");
  const gen = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the id list and mode
  useEffect(() => {
    const g = ++gen.current;
    setTotals(new Map());
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const cid = id;
        let value: Totals | "error";
        try {
          const page = await app.api.call(listPaymentIntents, {
            query: { customer: cid, status: "succeeded", limit: TOTALS_SCAN },
          });
          value = paidTotals(page.data, app.assets, page.has_more);
        } catch {
          value = "error";
        }
        if (gen.current !== g) return;
        setTotals((m) => new Map(m).set(cid, value));
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
  }, [key, app.mode, app.api, app.assets]);
  return totals;
}

export function useCustomerPayments(customerId: string) {
  const app = useApp();
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1);
  const state = useAsync(
    () =>
      app.api.call(listPaymentIntents, {
        query: { customer: customerId, limit: 10, ...(after ? { starting_after: after } : {}) },
      }),
    [customerId, after, app.mode, app.api],
  );
  const next = useCallback(() => {
    const last = state.data?.data.at(-1);
    if (last) setCursors((c) => [...c, last.id]);
  }, [state.data]);
  return { ...state, page: cursors.length, next, previous: () => setCursors((c) => c.slice(0, -1)) };
}
