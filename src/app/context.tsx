/** App state: API client, session, mode, account/requirements, asset registry, navigation, step-up. */
import {
  type Account as AccountSchema,
  type AnyRoute,
  getAccount,
  getAccountRequirements,
  listAssets,
  logout,
  type AccountRequirements as RequirementsSchema,
  type z,
} from "@nearpay/spec";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, type Mode } from "../lib/api";
import { API_BASE } from "../lib/config";
import { StepUpCanceled } from "../lib/errors";
import { hrefFor, modeFromSearch, withMode } from "../lib/mode";
import type { AssetInfo } from "../lib/money";
import { blockedReason } from "../lib/permissions";
import { type DashboardSession, sessionStore } from "../lib/session";

export type Account = z.output<typeof AccountSchema>;
export type Requirements = z.output<typeof RequirementsSchema>;

interface Loc {
  readonly pathname: string;
  readonly search: string;
}

export interface AppState {
  readonly api: ApiClient;
  readonly session: DashboardSession | null;
  setSession(s: DashboardSession | null): void;
  readonly mode: Mode;
  setMode(m: Mode): void;
  readonly location: Loc;
  navigate(to: string, opts?: { replace?: boolean }): void;
  href(path: string): string;
  readonly account: Account | undefined;
  readonly requirements: Requirements | undefined;
  refreshAccount(): void;
  readonly assets: ReadonlyMap<string, AssetInfo>;
  signOut(): Promise<void>;
  /** null = allowed; otherwise why the session user cannot call the route now. */
  gate(route: AnyRoute): string | null;
  /** Pending step-up request (rendered by the StepUp dialog). */
  readonly stepUp: { resolve(): void; reject(e: Error): void } | null;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

const store = sessionStore();

export function AppProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Loc>({ pathname: window.location.pathname, search: window.location.search });
  const [session, setSessionState] = useState<DashboardSession | null>(() => store.load());
  const [account, setAccount] = useState<Account>();
  const [requirements, setRequirements] = useState<Requirements>();
  const [assets, setAssets] = useState<ReadonlyMap<string, AssetInfo>>(new Map());
  const [stepUp, setStepUp] = useState<AppState["stepUp"]>(null);
  const [accountTick, setAccountTick] = useState(0);
  const mode = modeFromSearch(location.search);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setLocation({ pathname: window.location.pathname, search: window.location.search });
    window.scrollTo?.(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => setLocation({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setSession = useCallback((s: DashboardSession | null) => {
    if (s) store.save(s);
    else store.clear();
    sessionRef.current = s;
    setSessionState(s);
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        base: API_BASE,
        mode: () => modeRef.current,
        csrf: () => sessionRef.current?.csrf_token,
        stepUp: () =>
          new Promise<void>((resolve, reject) => {
            setStepUp({
              resolve: () => {
                setStepUp(null);
                resolve();
              },
              reject: (e) => {
                setStepUp(null);
                reject(e);
              },
            });
          }),
        unauthenticated: () => {
          if (!sessionRef.current) return;
          store.clear();
          sessionRef.current = null;
          setSessionState(null);
          setStepUp((s) => {
            s?.reject(new StepUpCanceled());
            return null;
          });
        },
      }),
    [],
  );

  // asset registry (anonymous) for amount formatting
  useEffect(() => {
    api.call(listAssets).then(
      (r) =>
        setAssets(new Map(r.data.map((a) => [a.asset_id, { symbol: a.symbol, decimals: a.decimals, chain: a.chain }]))),
      () => setAssets(new Map()),
    );
  }, [api]);

  // account + live-mode requirements for the signed-in user
  // biome-ignore lint/correctness/useExhaustiveDependencies: accountTick forces a refresh
  useEffect(() => {
    if (!session) {
      setAccount(undefined);
      setRequirements(undefined);
      return;
    }
    let live = true;
    api.call(getAccount).then(
      (a) => live && setAccount(a),
      () => {},
    );
    api.call(getAccountRequirements).then(
      (r) => live && setRequirements(r),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, session, accountTick, mode]);

  const value: AppState = {
    api,
    session,
    setSession,
    mode,
    setMode: (m) => navigate(`${location.pathname}${withMode(location.search, m)}`),
    location,
    navigate,
    href: (p) => hrefFor(p, mode),
    account,
    requirements,
    refreshAccount: () => setAccountTick((t) => t + 1),
    assets,
    signOut: async () => {
      try {
        await api.call(logout, { body: {} });
      } catch {
        // the session may already be gone; sign out locally anyway
      }
      setSession(null);
      navigate("/signin");
    },
    gate: (route) => blockedReason(route, { role: session?.role, mode, liveEnabled: requirements?.live_enabled }),
    stepUp,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** In-app link that keeps the mode and uses the History API. */
export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const app = useApp();
  const href = app.href(to);
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        app.navigate(href);
      }}
    >
      {children}
    </a>
  );
}
