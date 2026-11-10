/** Sign-in, sign-up and the magic-link page (design v2): the logo above a centred card on the canvas, no shell. */
import { NearPayLogo } from "@nearpay-internal/ui";
import type { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dash-auth">
      <header className="dash-auth__brand">
        <NearPayLogo size="lg" />
      </header>
      <main className="dash-auth__card np-card np-card--pad-md">{children}</main>
      <footer className="dash-auth__footer np-text-caption np-text-secondary">
        Get paid from any chain. Settle where you choose. NearPay never holds your funds.
      </footer>
    </div>
  );
}
