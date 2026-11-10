/**
 * Live checkout preview (design v2, artboard "Checkout-proposed"): the order side on navy (merchant, title,
 * price) above the pay side (network / token pickers, pay button) — decorative and inert, described for
 * screen readers. It updates as the form changes.
 */
import { Button, NearPayMark, PickerTrigger } from "@nearpay-internal/ui";

export function CheckoutPreview({
  merchant,
  title,
  price,
  payerFees,
}: {
  merchant: string;
  title: string;
  price: string | null;
  payerFees: boolean;
}) {
  return (
    <section className="npf-payment-links__preview" aria-labelledby="npf-plink-preview">
      <p className="npf-payment-links__eyebrow" id="npf-plink-preview">
        Checkout preview
      </p>
      <p className="np-sr-only">
        Customers see {merchant}, {title || "your title"} and {price ?? "the price"}, then choose the network and token
        they pay with.
      </p>
      <div className="npf-plink-ck" aria-hidden="true" inert>
        <div className="npf-plink-ck__order np-surface-navy">
          <p className="npf-plink-ck__merchant">
            <span className="npf-plink-ck__avatar">{merchant.trim().charAt(0).toUpperCase() || "M"}</span>
            {merchant}
          </p>
          <p className="npf-plink-ck__title">{title || "Your title"}</p>
          <p className="npf-plink-ck__price np-tabular" data-testid="preview-price">
            {price ?? "—"}
          </p>
          <p className="npf-plink-ck__note">
            {payerFees ? "Payment fees are added at checkout." : "No fees are added at checkout."}
          </p>
        </div>
        <div className="npf-plink-ck__pay">
          <p className="npf-plink-ck__label">Pay with</p>
          <div className="np-pickers">
            <PickerTrigger caption="Network" placeholder="Choose" tabIndex={-1} />
            <PickerTrigger caption="Token" placeholder="Choose" tabIndex={-1} />
          </div>
          <Button fullWidth size="lg" tabIndex={-1}>
            Pay {price ?? ""}
          </Button>
          <p className="npf-plink-ck__secured">
            <NearPayMark size={16} variant="mono" /> Secured by NearPay
          </p>
        </div>
      </div>
    </section>
  );
}
