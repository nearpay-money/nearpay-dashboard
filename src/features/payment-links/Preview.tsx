/** Live checkout preview card (Figma "CHECKOUT PREVIEW"): decorative, inert, described for screen readers. */
import { Button } from "@nearpay-internal/ui";

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
        Customers see {merchant}, {title || "your title"} and {price ?? "the price"}, then choose how to pay.
      </p>
      <div className="np-stack" aria-hidden="true" inert>
        <p className="npf-payment-links__merchant">{merchant}</p>
        <p className="np-text-h3">{title || "Your title"}</p>
        <p className="np-money np-money--hero" data-testid="preview-price">
          {price ?? "—"}
        </p>
        <p className="np-text-caption np-text-secondary">
          {payerFees ? "Payment fees are added at checkout." : "No fees are added at checkout."}
        </p>
        <Button fullWidth tabIndex={-1}>
          Connect wallet
        </Button>
        <Button fullWidth variant="secondary" tabIndex={-1}>
          Send from another wallet
        </Button>
      </div>
    </section>
  );
}
