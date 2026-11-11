/**
 * Sign-in, sign-up and the magic-link page, in the landing page's hero language: the form on white at the
 * left (logo, heading, form, footer), the kit's ConvergenceHero navy panel with the "Payment received" card on
 * a soft teal/violet wash at the right (≥ 1024 px only). No shell.
 */
import { ConvergenceHero, Money, NearPayLogo, StatusBadge } from "@nearpay-internal/ui";
import type { ReactNode } from "react";

const LABELS = ["USDC on Base", "SOL on Solana", "ETH on Arbitrum", "BTC", "NEAR"] as const;

function ReceivedCard() {
  return (
    <div className="dash-received">
      <div className="dash-received__head">
        <span className="dash-received__title">Payment received</span>
        <StatusBadge tone="success">Paid</StatusBadge>
      </div>
      <p className="dash-received__amount np-tabular">
        <Money amount={4900n} decimals={2} symbol="$" />
      </p>
      <p className="dash-received__sub">Settled as USDC to your NEAR wallet</p>
      <hr className="dash-received__rule" />
      <p className="dash-received__row">
        <span>Confirmed in</span>
        <strong>1 block</strong>
      </p>
    </div>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dash-auth">
      <div className="dash-auth__side">
        <header className="dash-auth__brand">
          <NearPayLogo size="sm" />
        </header>
        <main className="dash-auth__card">{children}</main>
        <footer className="dash-auth__footer">
          <span>NearPay never holds your funds.</span>
          <a href="https://nearpay.money/privacy">Privacy</a>
          <a href="https://nearpay.money/terms">Terms</a>
        </footer>
      </div>
      <aside className="dash-auth__art" aria-hidden="true">
        <div className="dash-auth__aurora" />
        <div className="dash-auth__panel">
          <p className="dash-auth__pitch">Accept crypto payments. Hassle-free.</p>
          <ConvergenceHero labels={LABELS} card={<ReceivedCard />} className="dash-auth__hero" />
        </div>
      </aside>
    </div>
  );
}
