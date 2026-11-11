/**
 * Workspace shell (design v2, artboard "Dashboard-proposed"): the kit AppShell v2 — navy sidebar with the
 * Convergence logo, the account switcher (`listMemberships` / `switchSessionAccount`, spec 0.2.0), the
 * registry's sidebar slots in two groups (workspace, then build: Developers, Settings), the signed-in user
 * and Sign out at the bottom; a top bar with the page/ID jumper (`Jump.tsx`), the Live/Test switch and
 * notifications; the test/live banners. Below 960 px the kit shows its navy mobile bar and the sidebar
 * opens as a drawer, closed again after every navigation.
 */

import { AppShell, Breadcrumb, Button, Callout, ModeSwitch, type NavGroup } from "@nearpay-internal/ui";
import { listMemberships, listPaymentIntents, listSettlementDestinations } from "@nearpay-money/spec";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAsync } from "../lib/hooks";
import { humanStatus } from "../lib/status";
import { ErrorNote, Loading, Modal } from "../ui/ui";
import { Link, useApp } from "./context";
import { useJump } from "./Jump";
import type { NavEntry, NavSlot } from "./registry";

export const HELP_URL = "https://docs.nearpay.money/support";

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

/** Sidebar slots of the second group (separated by a rule in the v2 sidebar). */
const BUILD_SLOTS: ReadonlySet<NavSlot> = new Set<NavSlot>(["developers", "settings"]);

export function Shell({ section, crumb, children }: ShellProps) {
  const app = useApp();
  const [switching, setSwitching] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const accountName = app.account?.display_name ?? app.session?.account.display_name ?? "";
  const navEntries = app.registry.nav;
  const item = (n: NavEntry) => ({ id: n.slot, label: n.label, href: app.href(n.href), current: n.slot === section });
  const nav: NavGroup[] = [
    { label: "Workspace", hideLabel: true, items: navEntries.filter((n) => !BUILD_SLOTS.has(n.slot)).map(item) },
    { label: "Build", hideLabel: true, items: navEntries.filter((n) => BUILD_SLOTS.has(n.slot)).map(item) },
  ].filter((g) => g.items.length > 0);
  const sectionEntry = navEntries.find((n) => n.slot === section);
  // detail pages and forms get a breadcrumb under the top bar; section pages are named by their heading
  const crumbs = crumb
    ? [...(sectionEntry ? [{ label: sectionEntry.label, href: app.href(sectionEntry.href) }] : []), { label: crumb }]
    : undefined;
  const jump = useJump();

  // close the mobile drawer and move focus to the page after a navigation
  const path = app.location.pathname;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void path;
    document.querySelector<HTMLButtonElement>(".np-shell--nav-open .np-shell__close")?.click();
    const t = setTimeout(() => {
      const h = document.querySelector<HTMLElement>(".np-shell__main h1");
      if (h) {
        h.setAttribute("tabindex", "-1");
        h.focus({ preventScroll: true });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [path]);

  const req = app.requirements;
  const unread = req && !req.live_enabled && app.mode === "live" ? 1 : 0;
  const role = app.session?.role;

  return (
    <AppShell
      className={`dash-shell dash-shell--${app.mode}`}
      workspace={{
        name: accountName,
        subtitle: app.account?.verified_legal_name ?? undefined,
        onSwitch: () => setSwitching(true),
      }}
      nav={nav}
      navLabel="Main"
      footerLinks={[{ label: "Help & support", href: HELP_URL }]}
      user={app.session ? { name: app.session.user.email, role: role ? humanStatus(role) : undefined } : undefined}
      footerActions={
        <Button variant="quiet" size="sm" className="dash-signout" onClick={() => void app.signOut()}>
          Sign out
        </Button>
      }
      breadcrumb={crumbs ? <Breadcrumb items={crumbs} /> : undefined}
      search={jump.search}
      modeSwitch={
        <span className="dash-mode" data-testid="mode-switch">
          <ModeSwitch value={app.mode} onChange={(m) => app.setMode(m)} label="Mode" />
        </span>
      }
      topbarActions={
        <>
          {jump.panel}
          <span hidden data-testid="account-name">
            {accountName}
          </span>
        </>
      }
      notifications={{ unread, onClick: () => setNotifying(true) }}
    >
      {app.mode === "test" && (
        <p className="dash-banner dash-banner--test" data-testid="test-banner">
          <strong>You're in test mode.</strong> No real funds move; payments use the sandbox.
        </p>
      )}
      {app.mode === "live" && req && !req.live_enabled && (
        <Callout
          tone="warning"
          title="Live payments are not active yet"
          className="dash-banner"
          data-testid="live-banner"
        >
          <p>
            Live keys and webhook endpoints unlock once you save your business details and a live payout wallet is
            active. <Link to="/setup">View requirements</Link>
          </p>
        </Callout>
      )}
      {app.accountError && !app.account ? (
        <div className="dash-banner">
          <ErrorNote error={app.accountError} onRetry={app.refreshAccount} />
        </div>
      ) : null}
      {children}
      {switching ? <AccountSwitcher onClose={() => setSwitching(false)} /> : null}
      {notifying ? <NotificationsPanel onClose={() => setNotifying(false)} /> : null}
    </AppShell>
  );
}
