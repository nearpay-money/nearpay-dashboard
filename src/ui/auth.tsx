/** Centered layout for sign-in, sign-up and the magic-link page (no workspace shell). */
import { NearPayLogo } from "@nearpay-internal/ui";
import type { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dash-auth">
      <header className="dash-auth__brand">
        <NearPayLogo />
      </header>
      <main className="dash-auth__card np-card np-card--pad-md">{children}</main>
      <footer className="dash-auth__footer np-text-caption np-text-secondary">
        Payments, with clarity. Funds settle directly to your wallet.
      </footer>
    </div>
  );
}
