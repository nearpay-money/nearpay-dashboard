import { Callout, ToastProvider } from "@nearpay-internal/ui";
import { type MouseEvent, useEffect, useMemo } from "react";
import { SignIn } from "../features/auth/SignIn";
import { SignUp } from "../features/auth/SignUp";
import { VerifyMagicLink } from "../features/auth/VerifyMagicLink";
import { matchPath, type RouteSpec } from "../lib/router";
import { Page } from "../ui/page";
import { Loading } from "../ui/ui";
import { AppProvider, Link, useApp } from "./context";
import stage2Areas from "./features";
import { buildRegistry, type FeatureModule, type Registry, type RouteDef } from "./registry";
import { Shell } from "./Shell";
import { StepUpDialog } from "./StepUp";

/** Every `src/features/<area>/module.tsx` (core areas and Stage 2 feature areas alike). */
const discovered = import.meta.glob<{ default: FeatureModule }>("../features/*/module.tsx", { eager: true });

export function loadRegistry(): Registry {
  const modules = Object.keys(discovered)
    .sort()
    .map((k) => discovered[k]?.default)
    .filter((m): m is FeatureModule => Boolean(m));
  return buildRegistry([...modules, stage2Areas]);
}

const PUBLIC_ROUTES: readonly RouteSpec[] = [
  { name: "signin", pattern: "/signin" },
  { name: "signup", pattern: "/signup" },
  { name: "verify", pattern: "/auth/verify" },
];

const PUBLIC = new Set(PUBLIC_ROUTES.map((r) => r.name));

function NotFound() {
  return (
    <Page title="Page not found" subtitle="The page you opened doesn't exist or has moved.">
      <Link to="/">Go to Overview</Link>
    </Page>
  );
}

function RoleNotice({ title }: { title: string }) {
  const app = useApp();
  return (
    <Page title={title}>
      <Callout tone="neutral" title="Not available for your role">
        Your role ({app.session?.role ?? "none"}) can't open this page. Ask an owner or admin.
      </Callout>
    </Page>
  );
}

function Page_() {
  const app = useApp();
  const routes = app.registry.routes;
  const table: RouteSpec[] = useMemo(() => [...PUBLIC_ROUTES, ...routes], [routes]);
  const m = matchPath(table, app.location.pathname);
  const isPublic = m !== null && PUBLIC.has(m.name);
  // wait for the session recovery (GET /v1/auth/session) before deciding where to go
  const needsSignIn = !app.restoring && !app.session && !isPublic;
  const signedInOnAuthPage = !app.restoring && app.session && (m?.name === "signin" || m?.name === "signup");
  const route: RouteDef | undefined = m ? routes.find((r) => r.name === m.name) : undefined;
  const params = m?.params ?? {};
  const title = route ? (typeof route.title === "function" ? route.title(params) : route.title) : undefined;

  useEffect(() => {
    if (needsSignIn) {
      const next = `${app.location.pathname}${app.location.search}`;
      app.navigate(next === "/" ? "/signin" : `/signin?next=${encodeURIComponent(next)}`, { replace: true });
    } else if (signedInOnAuthPage) {
      app.navigate("/", { replace: true });
    }
  }, [needsSignIn, signedInOnAuthPage, app]);

  useEffect(() => {
    const t = m?.name === "signin" ? "Sign in" : m?.name === "signup" ? "Create account" : title;
    document.title = t ? `${t} · NearPay` : "NearPay Dashboard";
  }, [title, m?.name]);

  if (app.restoring && !isPublic) return <Loading what="Restoring your session" />;
  if (needsSignIn || signedInOnAuthPage) return null;
  if (m?.name === "signin") return <SignIn />;
  if (m?.name === "signup") return <SignUp />;
  if (m?.name === "verify") return <VerifyMagicLink />;

  const role = app.session?.role;
  const forbidden = route?.roles !== undefined && (!role || !route.roles.includes(role));
  const content = !route ? (
    <NotFound />
  ) : forbidden ? (
    <RoleNotice title={title ?? "This page"} />
  ) : (
    route.render(params)
  );
  if (route?.layout === "focus") {
    return (
      <div key={`${app.session?.account.id}:${app.mode}`} className="dash-route">
        {content}
      </div>
    );
  }

  const nav = app.registry.nav.find((n) => n.slot === route?.section);
  // pages below their section (details, forms) get a third breadcrumb item
  const deeper = route && nav && title && nav.href !== route.pattern ? title : undefined;
  return (
    <Shell section={route?.section} crumb={deeper}>
      {/* a different account or mode is a different data set: remount the page */}
      <div key={`${app.session?.account.id}:${app.mode}`} className="dash-route">
        {content}
      </div>
    </Shell>
  );
}

/**
 * Plain `<a href>` elements rendered by kit components (sidebar, breadcrumb, table rows) navigate through
 * the History API like `<Link>`: same-origin, same-tab, unmodified primary clicks only.
 */
function useSpaLinks() {
  const app = useApp();
  return (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!(a instanceof HTMLAnchorElement)) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download") || a.origin !== window.location.origin) return;
    if (a.pathname.startsWith("/api/") || a.getAttribute("href")?.startsWith("#")) return;
    e.preventDefault();
    app.navigate(`${a.pathname}${a.search}`);
  };
}

function Root() {
  const onClick = useSpaLinks();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegated link handling; links stay keyboard-native
    <div className="np-root dash-root" data-theme="light" onClick={onClick}>
      <Page_ />
      <StepUpDialog />
    </div>
  );
}

export function App({ registry }: { registry?: Registry }) {
  const reg = useMemo(() => registry ?? loadRegistry(), [registry]);
  return (
    <AppProvider registry={reg}>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </AppProvider>
  );
}
