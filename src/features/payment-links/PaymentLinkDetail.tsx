/**
 * Payment link detail: share URL (copy / native share), price and usage, settings, payments made through
 * the link, edit of texts and limits (pricing is immutable), activate / deactivate (links are never deleted).
 */

import {
  Button,
  Callout,
  Card,
  CardTitle,
  Checkbox,
  Field,
  Input,
  KeyValueList,
  LiveRegion,
  Modal,
  PageHeader,
  Pager,
  Stat,
  StatGroup,
  StatusBadge,
  Table,
} from "@nearpay-internal/ui";
import { type PaymentIntent, type PaymentLink, updatePaymentLink } from "@nearpay-money/spec";
import { useRef, useState } from "react";
import { useApp } from "../../app/context";
import { QrCode } from "../../ui/QrCode";
import { useLink, useLinkCalls, useLinkPayments } from "./api";
import { linkStatus, optionalCount, optionalUrl, priceText, shareUrl, usesText } from "./logic";
import { ActionError, ErrorState, PageSkeleton } from "./parts";
import { fmtDate, useSpaLinks } from "./ui";
import "./payment-links.css";

/**
 * The share card, drawn after the landing `LinksCard`: product row (merchant tile, title, merchant, price),
 * the link with a violet Copy button, and a scannable QR code of the same link.
 */
function ShareCard({
  url,
  title,
  price,
  onShare,
}: {
  url: string;
  title: string;
  price: string;
  onShare?: () => void;
}) {
  const app = useApp();
  const [copied, setCopied] = useState(false);
  const merchant = app.account?.display_name ?? app.session?.account.display_name ?? "";
  const logo = app.account?.settings.branding.logo_url;
  return (
    <section className="npf-share" aria-labelledby="npf-share-title" data-testid="share-card">
      <h2 id="npf-share-title" className="np-sr-only">
        Share
      </h2>
      <div className="npf-share__prod">
        <span className="npf-share__thumb" aria-hidden="true">
          {logo ? <img src={logo} alt="" width={26} height={26} /> : (merchant.trim()[0] ?? "N").toUpperCase()}
        </span>
        <span className="npf-share__text">
          <b>{title}</b>
          <small>{merchant}</small>
        </span>
        <b className="npf-share__price np-tabular">{price}</b>
      </div>
      <div className="npf-share__linkrow">
        <span className="npf-share__url" title={url}>
          {url}
        </span>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // clipboard blocked: the link stays selectable
            }
          }}
          aria-label={copied ? "Link copied" : "Copy link"}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="npf-share__qrrow">
        <QrCode value={url} label={`QR code for ${url}`} className="npf-share__qr" />
        <span className="npf-share__qrtext">
          <b>Scan to pay</b>
          <small>Any token, any chain. Settles to your payout wallet.</small>
          {onShare ? (
            <Button variant="secondary" size="sm" onClick={onShare}>
              Share
            </Button>
          ) : null}
        </span>
      </div>
      {app.mode === "test" ? <p className="npf-share__note">Test mode: no real funds move.</p> : null}
    </section>
  );
}

export function PaymentLinkDetail({ id }: { id: string }) {
  const l = useLink(id);
  if (l.loading && !l.data) return <PageSkeleton label="Loading payment link" />;
  if (l.error || !l.data) return <ErrorState error={l.error} onRetry={l.reload} title="We couldn't load this link" />;
  return <LinkView key={l.data.id} initial={l.data} />;
}

function LinkView({ initial }: { initial: PaymentLink }) {
  const app = useApp();
  const calls = useLinkCalls();
  const [link, setLink] = useState(initial);
  const [announce, setAnnounce] = useState(() =>
    new URLSearchParams(app.location.search).get("created") === "1" ? "Payment link created. Copy it to share." : "",
  );
  const [confirmOff, setConfirmOff] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const root = useRef<HTMLDivElement>(null);
  useSpaLinks(root);
  const blocked = app.gate(updatePaymentLink);
  const url = shareUrl(link);
  const status = linkStatus(link);

  const setActive = async (active: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      setLink(await calls.update(link.id, { active }));
      setAnnounce(active ? "Link activated. New customers can pay." : "Link deactivated. New customers can't pay.");
      setConfirmOff(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({ title: link.description, url });
    } catch {
      // dismissed or unsupported: the copy field stays available
    }
  };

  return (
    <div className="np-stack np-stack--lg" ref={root}>
      <LiveRegion>{announce}</LiveRegion>
      <PageHeader
        title={link.name ?? link.description}
        subtitle={link.name ? `Payment link · “${link.description}” on checkout` : "Payment link"}
        status={<StatusBadge data-testid="link-status">{status.label}</StatusBadge>}
        actions={
          <>
            <Button variant="secondary" disabled={Boolean(blocked)} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {link.active ? (
              <Button
                variant="secondary"
                disabled={Boolean(blocked)}
                onClick={() => setConfirmOff(true)}
                data-testid="deactivate-link"
              >
                Deactivate
              </Button>
            ) : (
              <Button
                loading={busy}
                disabled={Boolean(blocked)}
                onClick={() => void setActive(true)}
                data-testid="activate-link"
              >
                Activate
              </Button>
            )}
          </>
        }
      />
      <ActionError error={error} />
      {status.detail && (
        <Callout tone="neutral" title={status.detail}>
          Raise or remove the limit to accept more payments.
        </Callout>
      )}
      {url ? (
        <ShareCard
          url={url}
          title={link.description}
          price={priceText(link, app.assets)}
          onShare={"share" in navigator ? () => void share() : undefined}
        />
      ) : (
        <Callout tone="warning" title="No shareable URL">
          The API returned an unexpected link URL. Contact support.
        </Callout>
      )}
      <StatGroup>
        <Stat label="Price" value={priceText(link, app.assets)} sub="Fixed after creation" />
        <Stat label="Payments" value={usesText(link)} sub={link.max_uses === null ? "No limit" : "Limit"} />
        <Stat label="Created" value={<span className="npf-payment-links__stat-text">{fmtDate(link.created)}</span>} />
      </StatGroup>
      <Card>
        <div className="np-stack">
          <CardTitle as="h2">Settings</CardTitle>
          <KeyValueList
            items={[
              { label: "Settles to", value: link.settlement_destination ?? "Account default destination" },
              { label: "After payment", value: link.success_url ?? "NearPay confirmation page" },
              { label: "Receipt email", value: link.collect_email ? "Asked at checkout" : "Not asked" },
              { label: "Checkout lifetime", value: `${Math.round(link.session_expires_in / 60)} minutes` },
              { label: "Link id", value: <code className="npf-payment-links__mono">{link.id}</code> },
            ]}
          />
        </div>
      </Card>
      <LinkPayments linkId={link.id} />

      <Modal
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="Deactivate this link?"
        description="New customers can't open it. Checkouts already open can still be paid; you can activate the link again."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOff(false)}>
              Keep active
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => void setActive(false)}
              data-testid="confirm-deactivate"
            >
              Deactivate
            </Button>
          </>
        }
      />
      <EditLink
        open={editing}
        link={link}
        onClose={() => setEditing(false)}
        onSaved={(l) => {
          setLink(l);
          setEditing(false);
          setAnnounce("Link updated.");
        }}
      />
    </div>
  );
}

function LinkPayments({ linkId }: { linkId: string }) {
  const app = useApp();
  const p = useLinkPayments(linkId);
  return (
    <section className="np-stack" aria-labelledby="npf-link-payments">
      <h2 className="np-text-h4" id="npf-link-payments">
        Payments
      </h2>
      {p.error ? (
        <ErrorState error={p.error} onRetry={p.reload} title="We couldn't load payments" />
      ) : (
        <Table
          caption="Payments through this link"
          columns={[
            {
              key: "pi",
              header: "Payment",
              primary: true,
              cell: (i: PaymentIntent) => i.description ?? i.id,
            },
            { key: "amount", header: "Amount", numeric: true, cell: (i: PaymentIntent) => priceText(i, app.assets) },
            {
              key: "status",
              header: "Status",
              cell: (i: PaymentIntent) => <StatusBadge>{intentLabel(i.status)}</StatusBadge>,
            },
            { key: "date", header: "Date", hideOnNarrow: true, cell: (i: PaymentIntent) => fmtDate(i.created) },
          ]}
          rows={p.data?.data ?? []}
          rowKey={(i) => i.id}
          rowHref={(i) => app.href(`/payments/${i.id}`)}
          loading={p.loading}
          empty="No payments through this link yet."
          footer={
            p.data && (p.data.has_more || p.page > 0) ? (
              <Pager hasPrevious={p.page > 0} hasNext={p.data.has_more} onPrevious={p.previous} onNext={p.next} />
            ) : undefined
          }
        />
      )}
    </section>
  );
}

function intentLabel(s: string): string {
  return (
    {
      succeeded: "Paid",
      processing: "Confirming",
      requires_payment: "Not paid",
      requires_review: "Review",
      canceled: "Canceled",
      expired: "Expired",
    }[s] ?? s.replace(/_/g, " ")
  );
}

function EditLink({
  open,
  link,
  onClose,
  onSaved,
}: {
  open: boolean;
  link: PaymentLink;
  onClose: () => void;
  onSaved: (l: PaymentLink) => void;
}) {
  const calls = useLinkCalls();
  const [title, setTitle] = useState(link.description);
  const [name, setName] = useState(link.name ?? "");
  const [maxUses, setMaxUses] = useState(link.max_uses === null ? "" : String(link.max_uses));
  const [successUrl, setSuccessUrl] = useState(link.success_url ?? "");
  const [collectEmail, setCollectEmail] = useState(link.collect_email);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const uses = optionalCount(maxUses);
  const url = optionalUrl(successUrl);
  const titleErr = title.trim() === "" ? "Enter what the customer pays for." : undefined;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit payment link"
      description="The price can't change after creation. Create a new link for a new price."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setTouched(true);
              if (titleErr || uses === undefined || url === undefined) return;
              setBusy(true);
              setError(undefined);
              try {
                onSaved(
                  await calls.update(link.id, {
                    description: title.trim(),
                    ...(name.trim() !== (link.name ?? "") ? { name: name.trim() || null } : {}),
                    max_uses: uses,
                    success_url: url,
                    collect_email: collectEmail,
                  }),
                );
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
            data-testid="save-link"
          >
            Save
          </Button>
        </>
      }
    >
      <div className="np-stack">
        <Field label="Title" error={touched ? titleErr : undefined} required>
          <Input value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Internal name (optional)" hint="Only your team sees it.">
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} data-testid="edit-link-name" />
        </Field>
        <Field
          label="Stop after this many payments"
          hint="Leave empty for no limit."
          error={touched && uses === undefined ? "Enter a whole number of 1 or more." : undefined}
        >
          <Input value={maxUses} inputMode="numeric" onChange={(e) => setMaxUses(e.target.value)} />
        </Field>
        <Field
          label="Redirect after payment"
          error={touched && url === undefined ? "Enter a full https URL." : undefined}
        >
          <Input value={successUrl} inputMode="url" onChange={(e) => setSuccessUrl(e.target.value)} />
        </Field>
        <Checkbox
          label="Ask for a receipt email"
          checked={collectEmail}
          onChange={(e) => setCollectEmail(e.target.checked)}
        />
        <ActionError error={error} />
      </div>
    </Modal>
  );
}
