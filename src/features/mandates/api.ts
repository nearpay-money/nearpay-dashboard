/** Mandate API hooks (spec 0.4.0 `mandates`). */
import {
  getMandate,
  type Invoice,
  listInvoices,
  listMandates,
  listSettlementDestinations,
  type Mandate,
} from "@nearpay/spec";
import { useApp } from "../../app/context";
import { useAsync, useCursorList } from "../../lib/hooks";

export const PAGE_SIZE = 20;

export interface MandateFilter {
  readonly status?: string;
  readonly link_status?: string;
  readonly subscription?: string;
  readonly customer?: string;
  readonly payer?: string;
}

export function useMandateList(f: MandateFilter, pageSize = PAGE_SIZE) {
  const app = useApp();
  return useCursorList<Mandate>(
    async (after) => {
      const r = await app.api.call(listMandates, {
        query: {
          limit: pageSize,
          ...(f.status ? { status: f.status } : {}),
          ...(f.link_status ? { link_status: f.link_status } : {}),
          ...(f.subscription ? { subscription: f.subscription } : {}),
          ...(f.customer ? { customer: f.customer } : {}),
          ...(f.payer ? { payer: f.payer } : {}),
          ...(after ? { starting_after: after } : {}),
        },
      });
      return { data: r.data as Mandate[], has_more: r.has_more };
    },
    [app.api, app.mode, f.status, f.link_status, f.subscription, f.customer, f.payer],
    pageSize,
  );
}

export function useMandate(id: string) {
  const app = useApp();
  return useAsync(() => app.api.call(getMandate, { params: { id } }) as Promise<Mandate>, [app.api, app.mode, id]);
}

/** Mandates of one subscription (newest first; ≤ 10 — a subscription has at most one linked active mandate). */
export function useSubscriptionMandates(subscription: string, sequence: number) {
  const app = useApp();
  return useAsync(
    async () => (await app.api.call(listMandates, { query: { subscription, limit: 10 } })).data as unknown as Mandate[],
    [app.api, app.mode, subscription, sequence],
  );
}

/** Paid invoices of the mandate's subscription (collections carry `mandate_collection`); first 100. */
export function useCollectionInvoices(subscription: string, sequence: number) {
  const app = useApp();
  return useAsync(async () => {
    const r = await app.api.call(listInvoices, { query: { subscription, status: "paid", limit: 100 } });
    return { invoices: r.data as Invoice[], capped: r.has_more };
  }, [app.api, app.mode, subscription, sequence]);
}

/** Active settlement destinations of this mode (auto-debit needs an active NEAR Intents account). */
export function useActiveDestinations() {
  const app = useApp();
  return useAsync(
    async () => (await app.api.call(listSettlementDestinations, { query: { limit: 100, status: "active" } })).data,
    [app.api, app.mode],
  );
}
