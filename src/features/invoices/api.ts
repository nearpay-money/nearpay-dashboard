/** Invoice API hooks (spec 0.3.0 `invoices`; events and payments read for the detail page). */
import {
  type Event,
  getInvoice,
  type Invoice,
  type InvoiceStatus,
  listEvents,
  listInvoices,
  listPaymentIntents,
  type z,
} from "@nearpay/spec";
import { useApp } from "../../app/context";
import { useAsync, useCursorList } from "../../lib/hooks";

export const PAGE_SIZE = 20;

export type StatusFilter = "" | "past_due" | z.output<typeof InvoiceStatus>;

export interface InvoiceFilter {
  readonly status: StatusFilter;
  readonly customer?: string;
  readonly subscription?: string;
}

/** Cursor-paged invoices; "Past due" = `open` with `due_date[lte]` now (the API status stays `open`). */
export function useInvoiceList(f: InvoiceFilter, pageSize = PAGE_SIZE) {
  const app = useApp();
  return useCursorList<Invoice>(
    async (after) => {
      const now = Math.floor(Date.now() / 1000);
      const status = f.status === "past_due" ? "open" : f.status;
      const r = await app.api.call(listInvoices, {
        query: {
          limit: pageSize,
          ...(status ? { status } : {}),
          ...(f.status === "past_due" ? { "due_date[lte]": now } : {}),
          ...(f.customer ? { customer: f.customer } : {}),
          ...(f.subscription ? { subscription: f.subscription } : {}),
          ...(after ? { starting_after: after } : {}),
        },
      });
      return { data: r.data as Invoice[], has_more: r.has_more };
    },
    [app.api, app.mode, f.status, f.customer, f.subscription],
    pageSize,
  );
}

/** One invoice; with no id (create form) nothing is fetched and `data` stays undefined. */
export function useInvoice(id: string | undefined) {
  const app = useApp();
  return useAsync(
    () => (id ? (app.api.call(getInvoice, { params: { id } }) as Promise<Invoice>) : Promise.resolve(undefined)),
    [id, app.mode, app.api],
  );
}

/** Pages of events scanned for one invoice's activity (events have no object filter in spec 0.3.0). */
const EVENT_PAGES = 3;

/**
 * The invoice's public events (`invoice.*` whose `data.object.id` is the invoice), scanning events
 * created since the invoice (≤ 300). `partial` when more events exist than were scanned.
 */
export function useInvoiceEvents(inv: Pick<Invoice, "id" | "created" | "sequence">) {
  const app = useApp();
  return useAsync(async () => {
    const mine: Event[] = [];
    let after: string | undefined;
    let more = false;
    for (let i = 0; i < EVENT_PAGES; i++) {
      const r = await app.api.call(listEvents, {
        query: { limit: 100, "created[gte]": inv.created, ...(after ? { starting_after: after } : {}) },
      });
      for (const e of r.data) {
        const obj = e.data.object as { id?: unknown };
        if (e.type.startsWith("invoice.") && obj.id === inv.id) mine.push(e as Event);
      }
      more = r.has_more;
      after = r.data.at(-1)?.id;
      if (!more || !after) break;
    }
    return { events: mine, partial: more };
  }, [app.api, app.mode, inv.id, inv.sequence]);
}

export function useInvoicePayments(id: string, sequence: number) {
  const app = useApp();
  return useAsync(
    () => app.api.call(listPaymentIntents, { query: { invoice: id, limit: 20 } }),
    [app.api, app.mode, id, sequence],
  );
}
