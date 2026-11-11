/** Payment-link API calls and hooks (spec 0.2.0 `payment-links`), plus the lists the pages need. */
import {
  createPaymentLink,
  getPaymentLink,
  listPaymentIntents,
  listPaymentLinks,
  listSettlementDestinations,
  type PaymentLink,
  updatePaymentLink,
} from "@nearpay-money/spec";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/context";
import { useAsync } from "../../lib/hooks";
import type { Pricing } from "./logic";

export const PAGE_SIZE = 20;

export interface CreateLinkInput {
  readonly pricing: Pricing;
  readonly description: string;
  /** Internal name (spec 0.2.1; never shown to payers). */
  readonly name?: string;
  readonly settlement_destination?: string;
  readonly success_url?: string;
  readonly max_uses?: number;
  readonly collect_email?: boolean;
}

export interface UpdateLinkInput {
  readonly active?: boolean;
  readonly description?: string;
  readonly name?: string | null;
  readonly success_url?: string | null;
  readonly max_uses?: number | null;
  readonly collect_email?: boolean;
}

export function useLinkCalls() {
  const { api } = useApp();
  return {
    create: (b: CreateLinkInput): Promise<PaymentLink> =>
      api.call(createPaymentLink, {
        body: {
          amount: b.pricing.amount,
          currency: b.pricing.currency,
          ...(b.pricing.asset_id ? { asset_id: b.pricing.asset_id } : {}),
          description: b.description,
          ...(b.name ? { name: b.name } : {}),
          ...(b.settlement_destination ? { settlement_destination: b.settlement_destination } : {}),
          ...(b.success_url ? { success_url: b.success_url } : {}),
          ...(b.max_uses ? { max_uses: b.max_uses } : {}),
          ...(b.collect_email !== undefined ? { collect_email: b.collect_email } : {}),
        },
      }),
    update: (id: string, b: UpdateLinkInput): Promise<PaymentLink> =>
      api.call(updatePaymentLink, { params: { id }, body: b }),
  };
}

export function useLink(id: string) {
  const app = useApp();
  return useAsync(() => app.api.call(getPaymentLink, { params: { id } }), [id, app.mode, app.api]);
}

/** Active destinations for "Receive payments in" (all modes; the API scopes by mode). */
export function useDestinations() {
  const app = useApp();
  return useAsync(
    () => app.api.call(listSettlementDestinations, { query: { limit: 100, status: "active" } }),
    [app.mode, app.api],
  );
}

function useCursor(key: string) {
  const [cursors, setCursors] = useState<string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter or mode starts at the first page
  useEffect(() => setCursors([]), [key]);
  return {
    cursors,
    after: cursors[cursors.length - 1],
    push: (id: string) => setCursors((c) => [...c, id]),
    pop: () => setCursors((c) => c.slice(0, -1)),
  };
}

export function useLinkList(active: "all" | "true" | "false") {
  const app = useApp();
  const c = useCursor(`${active}|${app.mode}`);
  const state = useAsync(
    () =>
      app.api.call(listPaymentLinks, {
        query: {
          limit: PAGE_SIZE,
          ...(c.after ? { starting_after: c.after } : {}),
          ...(active === "all" ? {} : { active }),
        },
      }),
    [active, c.after, app.mode, app.api],
  );
  const next = useCallback(() => {
    const last = state.data?.data.at(-1);
    if (last) c.push(last.id);
  }, [state.data, c]);
  return { ...state, page: c.cursors.length, next, previous: c.pop };
}

/** Payments created through one link (newest first). */
export function useLinkPayments(linkId: string) {
  const app = useApp();
  const c = useCursor(`${linkId}|${app.mode}`);
  const state = useAsync(
    () =>
      app.api.call(listPaymentIntents, {
        query: { limit: 10, payment_link: linkId, ...(c.after ? { starting_after: c.after } : {}) },
      }),
    [linkId, c.after, app.mode, app.api],
  );
  const next = useCallback(() => {
    const last = state.data?.data.at(-1);
    if (last) c.push(last.id);
  }, [state.data, c]);
  return { ...state, page: c.cursors.length, next, previous: c.pop };
}
