import type { ReactNode } from "react";
import { Link, useApp } from "./context";

const NAV: [string, string][] = [
  ["/", "Home"],
  ["/payments", "Payments"],
  ["/agent-payments", "Agent payments"],
  ["/settlement", "Settlement"],
  ["/developers", "Developers"],
  ["/settings", "Settings"],
];

export function Shell({ children }: { children: ReactNode }) {
  const app = useApp();
  const active = (p: string) =>
    p === "/"
      ? app.location.pathname === "/"
      : app.location.pathname === p || app.location.pathname.startsWith(`${p}/`);
  return (
    <div className={`shell mode-${app.mode}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            N
          </span>
          NearPay
        </div>
        <nav aria-label="Main">
          {NAV.map(([p, label]) => (
            <Link key={p} to={p} className={active(p) ? "nav-item active" : "nav-item"}>
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="account-name" data-testid="account-name">
            {app.account?.display_name ?? app.session?.account.display_name}
          </div>
          <fieldset className="mode-switch" aria-label="Mode">
            <button type="button" aria-pressed={app.mode === "test"} onClick={() => app.setMode("test")}>
              Test
            </button>
            <button type="button" aria-pressed={app.mode === "live"} onClick={() => app.setMode("live")}>
              Live
            </button>
          </fieldset>
          <div className="user">
            <span className="muted">{app.session?.user.email}</span>
            <button type="button" className="link-btn" onClick={() => void app.signOut()}>
              Sign out
            </button>
          </div>
        </header>
        {app.mode === "test" && (
          <div className="banner banner-test" data-testid="test-banner">
            Test mode — objects use the sandbox rail; no real money moves.
          </div>
        )}
        {app.mode === "live" && app.requirements && !app.requirements.live_enabled && (
          <div className="banner banner-warn" data-testid="live-banner">
            Live mode is not enabled yet ({app.requirements.missing.join(", ") || "pending"}). Live keys and webhooks
            unlock once the checklist on <Link to="/">Home</Link> is complete.
          </div>
        )}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
