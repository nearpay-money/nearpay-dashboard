/**
 * Workspace shell, drawn after the landing page's dashboard showcase (nearpay-site
 * `showcase/DashboardCard.astro`): a navy sidebar with the Convergence logo, the account switcher pill
 * (merchant logo + name; `listMemberships` / `switchSessionAccount`), the page/ID search (`Jump.tsx`, ⌘K),
 * the nav in three groups (the landing's seven items; Invoices and Developers; Business details, Team and
 * Settings), then help, notifications, the signed-in user and Sign out. The light content area carries the
 * Live/Test switch at the top right, level with the page heading. Test mode and "live payments are not
 * active yet" are thin strips across the top of the content. Below 960 px a navy bar with the logo and a
 * menu button sits on top and the sidebar opens as a drawer, closed again after every navigation.
 */

import {
  Breadcrumb,
  Button,
  Callout,
  ChevronUpDownIcon,
  CloseIcon,
  MenuIcon,
  ModeSwitch,
  NearPayMark,
} from "@nearpay-internal/ui";
import { listMemberships, listPaymentIntents, listSettlementDestinations } from "@nearpay-money/spec";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAsync } from "../lib/hooks";
import { humanStatus } from "../lib/status";
import { ErrorNote, Loading, Modal } from "../ui/ui";
import { Link, useApp } from "./context";
import { useJump } from "./Jump";
import type { NavEntry, NavSlot } from "./registry";

export const HELP_URL = "https://docs.nearpay.money/support";

/** `?accounts=open` opens the account switcher (the signed-in sign-up page links here). */
export const ACCOUNTS_PARAM = "accounts";

export interface ShellProps {
  /** Sidebar item of the current page. */
  section?: NavSlot;
  /** Last breadcrumb item when the page sits below its section (detail pages). */
  crumb?: string;
  children: ReactNode;
}

function shortId(id: string): string {
  const [prefix, rest = ""] = id.split("_");
  return rest.length > 8 ? `${prefix}_…${rest.slice(-4)}` : id;
}

function AccountSwitcher({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const list = useAsync(() => app.api.call(listMemberships), [app.api]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const memberships = list.data?.data ?? [];
  return (
    <Modal title="Switch account" onClose={onClose}>
      {list.loading ? <Loading what="Loading your accounts" rows={2} /> : null}
      {list.error ? (
        <Callout tone="neutral" title="You belong to one account.">
          <p>{app.account?.display_name ?? app.session?.account.display_name}</p>
        </Callout>
      ) : null}
      {list.data && memberships.length <= 1 ? (
        <p className="np-text-secondary">You belong to one account. Invitations to other accounts appear here.</p>
      ) : null}
      {memberships.length > 1 ? (
        <ul className="dash-account-list" aria-label="Your accounts">
          {memberships.map((m) => (
            <li key={m.account.id}>
              <button
                type="button"
                className="dash-account-option"
                aria-current={m.current ? "true" : undefined}
                disabled={m.current || busy !== undefined}
                onClick={async () => {
                  setBusy(m.account.id);
                  setError(undefined);
                  try {
                    await app.switchAccount(m.account.id);
                    onClose();
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(undefined);
                  }
                }}
              >
                <span className="dash-account-option__name">{m.account.display_name}</span>
                <span className="dash-account-option__meta">
                  {humanStatus(m.role)}
                  {m.current ? " · Current" : busy === m.account.id ? " · Switching…" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="np-text-caption np-text-secondary">
        Each business account has its own sign-in email. To run another business, sign up with a different email, or ask
        its owner to invite you; it then shows up here.
      </p>
      <div className="dash-account-footer">
        <p className="np-text-caption np-text-secondary">Signed in as {app.session?.user.email}</p>
        <Button variant="secondary" size="sm" onClick={() => void app.signOut()}>
          Sign out of NearPay
        </Button>
      </div>
      {error ? (
        <Callout tone="danger" role="alert" title="We couldn't switch accounts. Try again.">
          {error instanceof Error ? error.message : String(error)}
        </Callout>
      ) : null}
    </Modal>
  );
}

/** What needs the merchant's attention, from real data (no notifications API in v1). */
function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const reviews = useAsync(
    () => app.api.call(listPaymentIntents, { query: { limit: 10, status: "requires_review" } }),
    [app.api, app.mode],
  );
  const dests = useAsync(
    () => app.api.call(listSettlementDestinations, { query: { limit: 100 } }),
    [app.api, app.mode],
  );
  const req = app.requirements;
  const items: { key: string; title: string; body: string; to: string }[] = [];
  if (req && !req.live_enabled && app.mode === "live")
    items.push({
      key: "live",
      title: "Live payments are not active yet",
      body: "Finish the setup checklist to accept real payments.",
      to: "/setup",
    });
  for (const pi of reviews.data?.data ?? [])
    items.push({
      key: pi.id,
      title: "A payment needs review",
      body: `${pi.description ?? shortId(pi.id)} · ${humanStatus(pi.review_reason ?? "review")}`,
      to: `/payments/${pi.id}`,
    });
  for (const d of dests.data?.data ?? []) {
    if (d.status === "pending_approval")
      items.push({
        key: d.id,
        title: "A payout wallet is awaiting approval",
        body: `${d.label} needs an owner or admin to approve it.`,
        to: "/settlement",
      });
    if (d.status === "pending_verification")
      items.push({
        key: d.id,
        title: "A payout wallet is awaiting its signature",
        body: `${d.label} receives nothing until its wallet signs.`,
        to: `/settlement/${d.id}/attest`,
      });
  }
  const loading = reviews.loading || dests.loading;
  return (
    <Modal title="Notifications" description={`Things that need your attention in ${app.mode} mode.`} onClose={onClose}>
      {loading ? <Loading what="Loading notifications" rows={2} /> : null}
      {!loading && items.length === 0 ? <p className="np-text-secondary">You're all caught up.</p> : null}
      {items.length > 0 ? (
        <ul className="dash-notifications" aria-label="Notifications">
          {items.map((i) => (
            <li key={i.key}>
              <Link to={i.to} className="dash-notification">
                <span className="dash-notification__title">{i.title}</span>
                <span className="dash-notification__body">{i.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}

/** Sidebar groups: the landing showcase's seven items, then the rest (each group under a rule). */
const GROUPS: readonly (readonly NavSlot[])[] = [
  ["overview", "payments", "payment-links", "subscriptions", "customers", "agent-payments", "settlement"],
  ["invoices", "developers"],
  ["business", "team", "settings"],
];

/** The merchant's logo (account branding) or its initial on a white tile, as in the showcase pill. */
function MerchantLogo({ name, logo }: { name: string; logo?: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="dash-ws__logo" aria-hidden="true">
      {logo && !broken ? (
        <img src={logo} alt="" width={22} height={22} onError={() => setBroken(true)} />
      ) : (
        (name.trim()[0] ?? "N").toUpperCase()
      )}
    </span>
  );
}

export function Shell({ section, crumb, children }: ShellProps) {
  const app = useApp();
  const [switching, setSwitching] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const accountName = app.account?.display_name ?? app.session?.account.display_name ?? "";
  const navEntries = app.registry.nav;
  const bySlot = new Map(navEntries.map((n) => [n.slot, n]));
  const groups = GROUPS.map((g) => g.flatMap((s) => (bySlot.has(s) ? [bySlot.get(s) as NavEntry] : []))).filter(
    (g) => g.length > 0,
  );
  const sectionEntry = navEntries.find((n) => n.slot === section);
  // detail pages and forms get a breadcrumb above the heading; section pages are named by their heading
  const crumbs = crumb
    ? [...(sectionEntry ? [{ label: sectionEntry.label, href: app.href(sectionEntry.href) }] : []), { label: crumb }]
    : undefined;
  const jump = useJump();
  const menuButton = useRef<HTMLButtonElement>(null);

  // close the mobile drawer and move focus to the page after a navigation
  const path = app.location.pathname;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void path;
    setNavOpen(false);
    const t = setTimeout(() => {
      const h = document.querySelector<HTMLElement>(".dash-main h1");
      if (h) {
        h.setAttribute("tabindex", "-1");
        h.focus({ preventScroll: true });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [path]);

  // Escape closes the drawer (focus back on the menu button)
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".np-modal")) {
        setNavOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // `?accounts=open` (from the signed-in sign-up page) opens the account switcher once
  const search = app.location.search;
  useEffect(() => {
    const q = new URLSearchParams(search);
    if (q.get(ACCOUNTS_PARAM) !== "open") return;
    setSwitching(true);
    q.delete(ACCOUNTS_PARAM);
    const rest = q.toString();
    app.navigate(`${app.location.pathname}${rest ? `?${rest}` : ""}`, { replace: true });
  }, [search, app]);

  const req = app.requirements;
  const unread = req && !req.live_enabled && app.mode === "live" ? 1 : 0;
  const role = app.session?.role;
  const logo = app.account?.settings.branding.logo_url;

  return (
    <div className={`dash-app dash-app--${app.mode}${navOpen ? " dash-app--nav-open" : ""}`}>
      <div className="dash-mobilebar">
        <Link to="/" className="dash-logo" aria-label="NearPay home">
          <NearPayMark variant="dark" size={24} aria-hidden="true" />
          <span>NearPay</span>
        </Link>
        <button
          ref={menuButton}
          type="button"
          className="dash-mobilebar__menu"
          aria-label="Open menu"
          aria-expanded={navOpen}
          aria-controls="dash-sidebar"
          onClick={() => setNavOpen(true)}
        >
          <MenuIcon size={22} />
        </button>
      </div>
      {navOpen ? (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: scrim; Escape and the close button handle the keyboard
        <div className="dash-scrim" onClick={() => setNavOpen(false)} />
      ) : null}
      <aside id="dash-sidebar" className="dash-side" aria-label="Sidebar">
        <div className="dash-side__top">
          <div className="dash-side__brand">
            <Link to="/" className="dash-logo" aria-label="NearPay home">
              <NearPayMark variant="dark" size={24} aria-hidden="true" />
              <span>NearPay</span>
            </Link>
            <button
              type="button"
              className="dash-side__close"
              aria-label="Close menu"
              onClick={() => {
                setNavOpen(false);
                menuButton.current?.focus();
              }}
            >
              <CloseIcon size={20} />
            </button>
          </div>
          <button
            type="button"
            className="dash-ws"
            onClick={() => setSwitching(true)}
            aria-label={`${accountName}. Switch account`}
            data-testid="account-switcher"
          >
            <MerchantLogo name={accountName} logo={logo} />
            <span className="dash-ws__name">{accountName}</span>
            <ChevronUpDownIcon size={16} className="dash-ws__chevron" />
          </button>
          {jump.field}
        </div>
        <nav className="dash-nav" aria-label="Main">
          {groups.map((g) => (
            <ul key={g[0]?.slot} className="dash-nav__group">
              {g.map((n) => (
                <li key={n.slot}>
                  <a
                    href={app.href(n.href)}
                    className={n.slot === section ? "dash-nav__item is-current" : "dash-nav__item"}
                    aria-current={n.slot === section ? "page" : undefined}
                  >
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          ))}
        </nav>
        <div className="dash-side__foot">
          <button type="button" className="dash-side__link" onClick={() => setNotifying(true)}>
            <span>Notifications</span>
            {unread > 0 ? (
              <span className="dash-side__count">
                {unread}
                <span className="np-sr-only"> unread</span>
              </span>
            ) : null}
          </button>
          <a className="dash-side__link" href={HELP_URL} target="_blank" rel="noreferrer">
            Help and support
          </a>
          {app.session ? (
            <p className="dash-side__user">
              <span className="dash-side__email">{app.session.user.email}</span>
              {role ? <span className="dash-side__role">{humanStatus(role)}</span> : null}
            </p>
          ) : null}
          <button type="button" className="dash-side__signout" onClick={() => void app.signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="dash-main">
        {app.mode === "test" && (
          <p className="dash-strip dash-strip--test" data-testid="test-banner">
            <strong>Test mode.</strong> No real funds move; payments use the sandbox.
            {req && !req.live_enabled ? (
              <>
                {" "}
                Live payments are not active yet. <Link to="/setup">View the checklist</Link>
              </>
            ) : null}
          </p>
        )}
        {app.mode === "live" && req && !req.live_enabled && (
          <p className="dash-strip dash-strip--live" data-testid="live-banner">
            <strong>Live payments are not active yet.</strong> Live keys and webhook endpoints unlock once you save your
            business details and a live payout wallet is active. <Link to="/setup">View requirements</Link>
          </p>
        )}
        <div className={crumbs ? "dash-main__inner dash-main__inner--crumb" : "dash-main__inner"}>
          <div className="dash-mode" data-testid="mode-switch">
            <ModeSwitch value={app.mode} onChange={(m) => app.setMode(m)} label="Mode" />
          </div>
          {crumbs ? <Breadcrumb items={crumbs} className="dash-crumbs" /> : null}
          {app.accountError && !app.account ? (
            <div className="dash-banner">
              <ErrorNote error={app.accountError} onRetry={app.refreshAccount} />
            </div>
          ) : null}
          <span hidden data-testid="account-name">
            {accountName}
          </span>
          {children}
        </div>
      </main>
      {switching ? <AccountSwitcher onClose={() => setSwitching(false)} /> : null}
      {notifying ? <NotificationsPanel onClose={() => setNotifying(false)} /> : null}
    </div>
  );
}
