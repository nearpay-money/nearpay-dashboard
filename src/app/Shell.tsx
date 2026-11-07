/**
 * Workspace shell (Figma "workspace shell", tiles b00–b04; mobile b04/b05): the kit AppShell with the
 * sidebar slots filled from the feature registry, the account switcher (`listMemberships` /
 * `switchSessionAccount`, spec 0.2.0), breadcrumb, Live/Test switch, notifications, and the test/live
 * banners. Below 960 px the sidebar is a drawer (kit), closed again after every navigation.
 */
import { listMemberships, listPaymentIntents, listSettlementDestinations } from "@nearpay/spec";
import { AppShell, Breadcrumb, Button, Callout, type NavGroup, StatusBadge } from "@nearpay-internal/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAsync } from "../lib/hooks";
import { humanStatus } from "../lib/status";
import { ErrorNote, Loading, Modal } from "../ui/ui";
import { Link, useApp } from "./context";
import type { NavSlot } from "./registry";

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

/** Live/Test switch styled as the Figma mode pill (a `switch`: checked = live). */
function ModeSwitch() {
  const app = useApp();
  const live = app.mode === "live";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={live}
      aria-label="Live mode"
      className={`dash-mode-switch dash-mode-switch--${app.mode}`}
      title={live ? "Viewing live data. Switch to test mode." : "Viewing test data. Switch to live mode."}
      onClick={() => app.setMode(live ? "test" : "live")}
      data-testid="mode-switch"
    >
      <span className="dash-mode-switch__track" aria-hidden="true">
        <span className="dash-mode-switch__thumb" />
      </span>
      <StatusBadge tone={live ? "success" : "warning"}>{live ? "Live" : "Test"}</StatusBadge>
    </button>
  );
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
        title: "A destination is awaiting approval",
        body: `${d.label} needs an owner or admin to approve it.`,
        to: "/settlement",
      });
    if (d.status === "pending_verification")
      items.push({
        key: d.id,
        title: "A destination is awaiting its wallet signature",
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

export function Shell({ section, crumb, children }: ShellProps) {
  const app = useApp();
  const [switching, setSwitching] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const accountName = app.account?.display_name ?? app.session?.account.display_name ?? "";
  const navEntries = app.registry.nav;
  const nav: NavGroup[] = [
    {
      label: "Workspace",
      items: navEntries.map((n) => ({
        id: n.slot,
        label: n.label,
        href: app.href(n.href),
        current: n.slot === section,
      })),
    },
  ];
  const sectionEntry = navEntries.find((n) => n.slot === section);
  const crumbs = [
    { label: accountName, href: app.href("/") },
    ...(sectionEntry ? [{ label: sectionEntry.label, href: crumb ? app.href(sectionEntry.href) : undefined }] : []),
    ...(crumb ? [{ label: crumb }] : []),
  ];

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
        subtitle: app.account?.verified_legal_name ?? (app.account ? shortId(app.account.id) : undefined),
        onSwitch: () => setSwitching(true),
      }}
      nav={nav}
      footerLinks={[{ label: "Help & support", href: HELP_URL }]}
      user={app.session ? { name: app.session.user.email, role: role ? humanStatus(role) : undefined } : undefined}
      breadcrumb={<Breadcrumb items={crumbs} />}
      topbarActions={
        <>
          <ModeSwitch />
          <Button variant="ghost" size="sm" className="dash-signout" onClick={() => void app.signOut()}>
            Sign out
          </Button>
          <span hidden data-testid="account-name">
            {accountName}
          </span>
        </>
      }
      notifications={{ unread, onClick: () => setNotifying(true) }}
    >
      {app.mode === "test" && (
        <p className="dash-banner dash-banner--test" data-testid="test-banner">
          <strong>Test mode — no real funds.</strong> Objects use the sandbox rail.
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
            Live keys and webhook endpoints unlock once your business details are reviewed and a live destination is
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
