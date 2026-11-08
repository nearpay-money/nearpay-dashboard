/** Subscription API hooks (spec 0.3.0 `subscriptions`). */
import {
  getInvoice,
  getSubscription,
  type Invoice,
  listSubscriptions,
  type Subscription,
  type SubscriptionStatus,
  type z,
} from "@nearpay/spec";
import { useApp } from "../../app/context";
import { useAsync, useCursorList } from "../../lib/hooks";

export const PAGE_SIZE = 20;
export type SubStatusFilter = "" | z.output<typeof SubscriptionStatus>;

export function useSubscriptionList(f: { status: SubStatusFilter; customer?: string }, pageSize = PAGE_SIZE) {
  const app = useApp();
  return useCursorList<Subscription>(
    async (after) => {
      const r = await app.api.call(listSubscriptions, {
        query: {
          limit: pageSize,
          ...(f.status ? { status: f.status } : {}),
          ...(f.customer ? { customer: f.customer } : {}),
          ...(after ? { starting_after: after } : {}),
        },
      });
      return { data: r.data as Subscription[], has_more: r.has_more };
    },
    [app.api, app.mode, f.status, f.customer],
    pageSize,
  );
}

export function useSubscription(id: string) {
  const app = useApp();
  return useAsync(
    () => app.api.call(getSubscription, { params: { id } }) as Promise<Subscription>,
    [id, app.mode, app.api],
  );
}

/** The subscription's latest invoice (dunning status), or null when it has none. */
export function useLatestInvoice(s: Pick<Subscription, "latest_invoice" | "sequence">) {
  const app = useApp();
  return useAsync(
    async () =>
      s.latest_invoice ? ((await app.api.call(getInvoice, { params: { id: s.latest_invoice } })) as Invoice) : null,
    [app.api, app.mode, s.latest_invoice, s.sequence],
  );
}
