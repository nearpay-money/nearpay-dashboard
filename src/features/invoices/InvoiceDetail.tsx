/**
 * Invoice detail (lld/billing.md §4–§5, §11; Figma mobile "Invoice INV–2041"): amounts, payment page
 * link, lines and tax, activity from events, linked payments, and the status actions — finalize, send
 * (one email per 10 minutes), void, mark uncollectible, delete draft, PDF download. There is no
 * "mark paid": an invoice is paid only by a verified payment (INV-2).
 */
import {
  deleteInvoice,
  finalizeInvoice,
  getInvoicePdf,
  type Invoice,
  markInvoiceUncollectible,
  type PaymentIntent,
  sendInvoice,
  voidInvoice,
} from "@nearpay/spec";
import {
  Button,
  Callout,
  CopyText,
  KeyValueList,
  LiveRegion,
  MenuButton,
  StatusBadge,
  Table,
  Timeline,
  useToast,
} from "@nearpay-internal/ui";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import {
  amountText,
  dunningState,
  durationText,
  percentText,
  reminderDaysText,
  SEND_INTERVAL_S,
  sendCooldown,
} from "../../lib/billing";
import { ApiError } from "../../lib/errors";
import { formatDate, formatWhen } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { roleAllows } from "../../lib/permissions";
import { statusOf } from "../../lib/status";
import { ConfirmDialog, ErrorState, LoadingState, Page, Section, StatRow } from "../../ui/page";
import { ErrorNote } from "../../ui/ui";
import { InvoiceStatus, saveBlob, useCustomerNames } from "../billing/shared";
import "../billing/billing.css";
import { useInvoice, useInvoiceEvents, useInvoicePayments } from "./api";
import { invoiceActions, invoiceActivity } from "./logic";

export function InvoiceDetail({ id }: { id: string }) {
  const inv = useInvoice(id);
  if (inv.loading && !inv.data) return <LoadingState what="Loading invoice" stats={3} />;
  if (inv.error || !inv.data) return <ErrorState title="Invoice" error={inv.error} onRetry={inv.reload} />;
  return <InvoiceView key={inv.data.id} initial={inv.data} />;
}

type Pending = "finalize" | "void" | "uncollectible" | "delete" | undefined;

const REASONS: Readonly<Record<string, string>> = {
  manual: "Created in the dashboard or API",
  subscription_create: "First invoice of a subscription",
  subscription_cycle: "Subscription renewal",
};

function InvoiceView({ initial }: { initial: Invoice }) {
  const app = useApp();
  const toast = useToast();
  const [inv, setInv] = useState(initial);
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [announce, setAnnounce] = useState(() =>
    new URLSearchParams(app.location.search).get("finalized") === "1"
      ? "Invoice finalized. Its payment page is ready."
      : "",
  );
  const now = useNow(1000);
  const names = useCustomerNames([inv.customer]);
  const customer = names.get(inv.customer) ?? "…";
  const acts = invoiceActions(inv);
  const can = (r: Parameters<typeof roleAllows>[0]) =>
    app.gate(r as never) === null && roleAllows(r, app.session?.role);
  const money = (amount: number | string) =>
    amountText({ amount, currency: inv.currency, asset_id: inv.asset_id }, app.assets);
  const cooldown = sendCooldown(inv.status_transitions.sent_at, now);

  const run = async (key: string, fn: () => Promise<Invoice | undefined>, done?: string) => {
    setBusy(key);
    setError(undefined);
    try {
      const next = await fn();
      if (next) setInv(next);
      setPending(undefined);
      if (done) {
        setAnnounce(done);
        toast.show({ tone: "success", title: done });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };
  const call = (
    route: typeof finalizeInvoice | typeof sendInvoice | typeof voidInvoice | typeof markInvoiceUncollectible,
  ) => app.api.call(route, { params: { id: inv.id }, body: {} }) as Promise<Invoice>;

  const download = async () => {
    setBusy("pdf");
    setError(undefined);
    try {
      const { blob, filename } = await app.api.download(getInvoicePdf, { params: { id: inv.id } });
      saveBlob(blob, filename ?? `${inv.number ?? inv.id}.pdf`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setError(undefined);
    try {
      await app.api.call(deleteInvoice, { params: { id: inv.id } });
      app.navigate(app.href("/billing"));
    } catch (e) {
      setError(e);
      setBusy(undefined);
    }
  };

  const sendBlocked =
    cooldown > 0 ? `Emailed recently. You can send again in ${durationText(cooldown)}.` : app.gate(sendInvoice);
  const more = [
    ...(acts.void && can(voidInvoice) ? [{ id: "void", label: "Void invoice", danger: true }] : []),
    ...(acts.uncollectible && can(markInvoiceUncollectible)
      ? [{ id: "uncollectible", label: "Mark uncollectible" }]
      : []),
  ];
  const actions = (
    <>
      {acts.edit && can(deleteInvoice) && (
        <Button variant="ghost" onClick={() => setPending("delete")} data-testid="delete-invoice">
          Delete draft
        </Button>
      )}
      {acts.edit && roleAllows(finalizeInvoice, app.session?.role) && (
        <Link
          to={`/billing/invoices/${inv.id}/edit`}
          className="np-button np-button--secondary"
          data-testid="edit-invoice"
        >
          <span>Edit</span>
        </Link>
      )}
      {acts.finalize && roleAllows(finalizeInvoice, app.session?.role) && (
        <Button
          onClick={() => setPending("finalize")}
          disabled={app.gate(finalizeInvoice) !== null}
          title={app.gate(finalizeInvoice) ?? undefined}
          data-testid="finalize-invoice"
        >
          Finalize invoice
        </Button>
      )}
      {acts.pdf && (
        <Button
          variant="secondary"
          loading={busy === "pdf"}
          loadingText="Preparing PDF…"
          onClick={() => void download()}
          data-testid="download-pdf"
        >
          Download PDF
        </Button>
      )}
      {more.length > 0 && (
        <MenuButton
          label="More invoice actions"
          triggerLabel="More actions"
          variant="ghost"
          items={more}
          onSelect={(id) => setPending(id as Pending)}
          align="end"
          data-testid="invoice-more"
        >
          More
        </MenuButton>
      )}
      {acts.send && roleAllows(sendInvoice, app.session?.role) && (
        <Button
          loading={busy === "send"}
          loadingText="Sending…"
          disabled={sendBlocked !== null}
          aria-describedby="npf-send-hint"
          onClick={() =>
            void run(
              "send",
              () => call(sendInvoice),
              `Invoice emailed to ${customer === "…" ? "the customer" : customer}.`,
            )
          }
          data-testid="send-invoice"
        >
          {inv.status_transitions.sent_at ? "Send again" : "Send invoice"}
        </Button>
      )}
    </>
  );

  const dun = dunningState(inv);
  return (
    <Page
      title={inv.number ? `Invoice ${inv.number}` : "Draft invoice"}
      subtitle={`Billed to ${customer} · Created ${formatDate(inv.created)}`}
      status={<InvoiceStatus invoice={inv} now={now} />}
      back={{ label: "Billing", to: "/billing" }}
      actions={actions}
      data-testid="invoice-detail"
    >
      <LiveRegion>{announce}</LiveRegion>
      {error ? <InvoiceError error={error} customerId={inv.customer} /> : null}
      <StatRow
        items={[
          {
            label: "Amount due",
            value: money(inv.amount_due),
            sub: inv.tax !== 0 && inv.tax !== "0" ? `Includes ${money(inv.tax)} tax` : "No tax",
          },
          {
            label: "Paid",
            value: money(inv.amount_paid),
            sub: inv.status_transitions.paid_at ? formatWhen(inv.status_transitions.paid_at) : "Nothing paid yet",
          },
          {
            label: "Due date",
            value: inv.due_date ? formatDate(inv.due_date) : "On finalize",
            sub: inv.due_date
              ? dueText(inv.due_date, now, inv.status)
              : inv.days_until_due !== null
                ? `${inv.days_until_due} days after finalize`
                : undefined,
          },
        ]}
      />
      {inv.status === "draft" ? (
        <Callout title="This invoice is a draft">
          Nobody can see or pay it yet. Finalize it to assign the number and due date and create its payment page;
          nothing is emailed until you send it.
        </Callout>
      ) : null}
      {acts.link && inv.hosted_invoice_url ? (
        <Section title="Payment page" data-testid="payment-page">
          <div className="npf-billing__link-row">
            <CopyText
              value={inv.hosted_invoice_url}
              label="Copy payment link"
              copiedLabel="Payment link copied"
              className="npf-billing__link"
              data-testid="hosted-link"
            >
              {inv.hosted_invoice_url.split("#")[0]}
            </CopyText>
            <a
              href={inv.hosted_invoice_url}
              target="_blank"
              rel="noopener noreferrer"
              className="np-button np-button--secondary np-button--sm"
            >
              <span>Open payment page</span>
            </a>
          </div>
          <p className="np-text-small np-text-secondary">
            Anyone with this link can view the invoice and pay it, so share it only with your customer. Payment fees are
            shown to the payer at checkout. Funds settle directly to your chosen wallet.
          </p>
          <p className="np-text-small" id="npf-send-hint" data-testid="send-status">
            {inv.status_transitions.sent_at
              ? `Last emailed ${formatWhen(inv.status_transitions.sent_at)}. `
              : "Not emailed yet. "}
            {cooldown > 0
              ? `An invoice can be emailed once every ${SEND_INTERVAL_S / 60} minutes — next send in ${durationText(cooldown)}.`
              : `An invoice can be emailed once every ${SEND_INTERVAL_S / 60} minutes.`}
          </p>
        </Section>
      ) : null}
      {inv.status === "uncollectible" ? (
        <Callout tone="warning" title="Marked uncollectible">
          {inv.uncollectible_reason === "dunning_exhausted"
            ? "The last reminder went out without payment."
            : "You wrote this invoice off."}{" "}
          Reminders stopped, but the payment page still accepts payment; a late payment marks it paid.
        </Callout>
      ) : null}
      <Section title="Items">
        <Table
          caption="Invoice items"
          rows={inv.lines}
          rowKey={(l) => l.id}
          empty="No items yet. Edit the draft to add one."
          columns={[
            {
              key: "d",
              header: "Item",
              primary: true,
              cell: (l) => (
                <span className="npf-billing__line">
                  <span>{l.description}</span>
                  {l.period ? (
                    <span className="np-text-small np-text-secondary">
                      {formatDate(l.period.start)} – {formatDate(l.period.end)}
                    </span>
                  ) : null}
                  {l.tax_amounts.length ? (
                    <span className="np-text-small np-text-secondary">
                      {l.tax_amounts
                        .map((t) => `${t.display_name} ${percentText(t.percentage)}${t.inclusive ? " incl." : ""}`)
                        .join(" · ")}
                    </span>
                  ) : null}
                </span>
              ),
            },
            { key: "q", header: "Qty", numeric: true, cell: (l) => String(l.quantity) },
            { key: "u", header: "Unit price", numeric: true, hideOnNarrow: true, cell: (l) => money(l.unit_amount) },
            { key: "a", header: "Amount", numeric: true, cell: (l) => money(l.amount) },
          ]}
        />
        <div className="npf-billing__totals">
          <KeyValueList
            items={[
              { label: "Subtotal", value: money(inv.subtotal) },
              ...inv.total_tax_amounts.map((t) => ({
                label: `${t.display_name} ${percentText(t.percentage)}${t.inclusive ? " (included)" : ""}`,
                value: money(t.amount),
              })),
              ...(inv.total_tax_amounts.length === 0 ? [{ label: "Tax", value: money(0) }] : []),
              { label: "Amount due", value: money(inv.amount_due), total: true },
              ...(inv.status !== "draft"
                ? [
                    { label: "Paid", value: money(inv.amount_paid) },
                    { label: "Remaining", value: money(inv.amount_remaining) },
                  ]
                : []),
            ]}
          />
        </div>
      </Section>
      <div className="npf-billing__columns">
        <Section title="Details">
          <KeyValueList
            items={[
              { label: "Customer", value: <Link to={`/customers/${inv.customer}`}>{customer}</Link> },
              { label: "Number", value: inv.number ?? "Assigned when finalized" },
              { label: "Reason", value: REASONS[inv.billing_reason] ?? inv.billing_reason },
              ...(inv.subscription
                ? [
                    {
                      label: "Subscription",
                      value: <Link to={`/billing/subscriptions/${inv.subscription}`}>View subscription</Link>,
                    },
                  ]
                : []),
              { label: "Collection", value: "Customer pays the payment page from their wallet" },
              { label: "Note to customer", value: inv.description ?? "—" },
              ...(inv.footer ? [{ label: "Footer", value: inv.footer }] : []),
              {
                label: "Reminders",
                value:
                  dun.kind === "scheduled"
                    ? `${dun.sent} of ${dun.total} sent${dun.next ? ` · next ${formatWhen(dun.next)}` : ""}`
                    : dun.kind === "exhausted"
                      ? `All ${dun.total} sent`
                      : reminderDaysText(inv.reminder_days),
              },
              { label: "Schedule", value: reminderDaysText(inv.reminder_days) },
              { label: "Invoice ID", value: <code className="npf-billing__mono">{inv.id}</code> },
            ]}
          />
        </Section>
        <InvoiceActivity invoice={inv} />
      </div>
      <InvoicePayments invoice={inv} />

      <ConfirmDialog
        open={pending === "finalize"}
        title="Finalize this invoice?"
        description="NearPay assigns the invoice number and due date, renders the PDF and creates the payment page. The amounts can't change afterwards. Nothing is emailed until you send it."
        confirmLabel="Finalize invoice"
        tone="primary"
        busy={busy === "finalize"}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() =>
          void run("finalize", () => call(finalizeInvoice), "Invoice finalized. Its payment page is ready.")
        }
      />
      <ConfirmDialog
        open={pending === "void"}
        title="Void this invoice?"
        description="The payment page stops accepting payments and reminders stop. Voiding is final — create a new invoice if the customer still owes you. If a payment still settles, you'll refund it from the payment page."
        confirmLabel="Void invoice"
        busy={busy === "void"}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() => void run("void", () => call(voidInvoice), "Invoice voided.")}
      />
      <ConfirmDialog
        open={pending === "uncollectible"}
        title="Mark as uncollectible?"
        description="Reminders stop and the invoice no longer counts as outstanding. The payment page stays open: if the customer pays later, the invoice is marked paid."
        confirmLabel="Mark uncollectible"
        busy={busy === "uncollectible"}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() =>
          void run("uncollectible", () => call(markInvoiceUncollectible), "Invoice marked uncollectible.")
        }
      />
      <ConfirmDialog
        open={pending === "delete"}
        title="Delete this draft?"
        description="The draft and its items are removed. This can't be undone."
        confirmLabel="Delete draft"
        busy={busy === "delete"}
        error={error}
        onClose={() => setPending(undefined)}
        onConfirm={() => void remove()}
      />
    </Page>
  );
}

/** `Due in 3 days` / `Due today` / `2 days overdue` while open; the status otherwise. */
function dueText(due: number, now: number, status: string): string {
  if (status !== "open") return statusOf("invoice", status).label;
  const days = Math.floor((due - now) / 86_400);
  if (due < now) return `${Math.max(1, Math.ceil((now - due) / 86_400))} day${now - due > 86_400 ? "s" : ""} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

/** Errors of invoice actions, with the next step where there is one. */
function InvoiceError({ error, customerId }: { error: unknown; customerId: string }) {
  if (error instanceof ApiError && error.code === "rate_limited")
    return (
      <Callout tone="warning" title="Emailed recently" role="alert">
        Each invoice can be emailed once every 10 minutes. Try again later.
      </Callout>
    );
  if (error instanceof ApiError && error.code === "customer_email_missing")
    return (
      <Callout tone="warning" title="This customer has no email address" role="alert">
        <Link to={`/customers/${customerId}`}>Add an email on the customer page</Link>, then send again — or copy the
        payment link and share it yourself.
      </Callout>
    );
  return <ErrorNote error={error} />;
}

function InvoiceActivity({ invoice }: { invoice: Invoice }) {
  const ev = useInvoiceEvents(invoice);
  const items = invoiceActivity(invoice, ev.data?.events ?? []);
  return (
    <Section title="Activity" aside={ev.data?.partial ? "Recent events" : undefined} data-testid="invoice-activity">
      {ev.error ? (
        <p className="np-text-small np-text-secondary">Showing status changes only — events couldn't load.</p>
      ) : null}
      <Timeline
        label="Invoice activity"
        items={items.map((a) => ({
          id: a.id,
          time: formatWhen(a.at),
          dateTime: new Date(a.at * 1000).toISOString(),
          title: a.title,
          body: a.body,
          state: a.state,
        }))}
      />
    </Section>
  );
}

const INTENT: Readonly<Record<string, string>> = { succeeded: "Paid" };

function InvoicePayments({ invoice }: { invoice: Invoice }) {
  const app = useApp();
  const p = useInvoicePayments(invoice.id, invoice.sequence);
  const rows = (p.data?.data ?? []) as PaymentIntent[];
  const late =
    (invoice.status === "paid" || invoice.status === "void") &&
    rows.filter((i) => i.status === "succeeded" && i.id !== invoice.payment_intent).length > 0;
  return (
    <Section title="Payments" data-testid="invoice-payments">
      {late ? (
        <Callout tone="warning" title="A payment arrived after this invoice was settled">
          Funds settled to your wallet, but the invoice was already {invoice.status === "void" ? "void" : "paid"}.
          Refund the extra payment from its payment page.
        </Callout>
      ) : null}
      {p.error ? (
        <ErrorNote error={p.error} onRetry={p.reload} />
      ) : (
        <Table<PaymentIntent>
          caption="Payments for this invoice"
          loading={p.loading && !p.data}
          rows={rows}
          rowKey={(i) => i.id}
          rowHref={(i) => app.href(`/payments/${i.id}`)}
          empty={
            invoice.status === "draft"
              ? "Payments appear once the invoice is finalized and paid."
              : "No payment attempts yet."
          }
          columns={[
            {
              key: "id",
              header: "Payment",
              primary: true,
              cell: (i) => <code className="npf-billing__mono">{i.id}</code>,
            },
            {
              key: "a",
              header: "Amount",
              numeric: true,
              cell: (i) => amountText({ amount: i.amount, currency: i.currency, asset_id: i.asset_id }, app.assets),
            },
            {
              key: "s",
              header: "Status",
              cell: (i) => {
                const s = statusOf("payment", i.status);
                return <StatusBadge tone={s.tone}>{INTENT[i.status] ?? s.label}</StatusBadge>;
              },
            },
            { key: "t", header: "Created", hideOnNarrow: true, cell: (i) => formatWhen(i.created) },
          ]}
        />
      )}
    </Section>
  );
}
