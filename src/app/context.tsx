/** App state: API client, session, mode, account/requirements, asset registry, navigation, step-up. */
import {
  type Account as AccountSchema,
  type AnyRoute,
  getAccount,
  getAccountRequirements,
  listAssets,
  logout,
  type AccountRequirements as RequirementsSchema,
  switchSessionAccount,
  type z,
} from "@nearpay/spec";
import {
  type AnchorHTMLAttributes,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiClient, type Mode } from "../lib/api";
import { API_BASE } from "../lib/config";
import { StepUpCanceled } from "../lib/errors";
import { hrefFor, modeFromSearch, withMode } from "../lib/mode";
import type { AssetInfo } from "../lib/money";
import { blockedReason } from "../lib/permissions";
import { clearLegacySession, type DashboardSession, restoreSession } from "../lib/session";
import { buildRegistry, type Registry } from "./registry";

export type Account = z.output<typeof AccountSchema>;
export type Requirements = z.output<typeof RequirementsSchema>;

interface Loc {
  readonly pathname: string;
  readonly search: string;
}

export interface AppState {
  readonly api: ApiClient;
  readonly session: DashboardSession | null;
  /** True until `GET /v1/auth/session` has answered on load (reload / new tab). */
  readonly restoring: boolean;
  setSession(s: DashboardSession | null): void;
  readonly mode: Mode;
  setMode(m: Mode): void;
  readonly location: Loc;
  navigate(to: string, opts?: { replace?: boolean }): void;
  href(path: string): string;
  readonly account: Account | undefined;
  /** Why `getAccount` failed (pages show it with a retry: `refreshAccount`), or undefined. */
  readonly accountError: unknown;
  readonly requirements: Requirements | undefined;
  refreshAccount(): void;
  readonly assets: ReadonlyMap<string, AssetInfo>;
  signOut(): Promise<void>;
  /** null = allowed; otherwise why the session user cannot call the route now. */
  gate(route: AnyRoute): string | null;
  /** Pending step-up request (rendered by the StepUp dialog). */
  readonly stepUp: { resolve(): void; reject(e: Error): void } | null;
  /** Routes, sidebar entries and settings cards of every feature module (`./registry.ts`). */
  readonly registry: Registry;
  /** Makes the session act for another account of the user (`switchSessionAccount`), then opens Overview. */
  switchAccount(accountId: string): Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

const EMPTY_REGISTRY = buildRegistry([]);

export function AppProvider({ children, registry = EMPTY_REGISTRY }: { children: ReactNode; registry?: Registry }) {
  const [location, setLocation] = useState<Loc>({ pathname: window.location.pathname, search: window.location.search });
  const [session, setSessionState] = useState<DashboardSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [account, setAccount] = useState<Account>();
  const [accountError, setAccountError] = useState<unknown>();
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

  // session recovery on load: the cookie is the credential, the API re-issues the session + CSRF token
  useEffect(() => {
    clearLegacySession();
    let live = true;
    restoreSession(api)
      .catch(() => null) // API unreachable: treat as signed out; signing in reports the error
      .then((s) => {
        if (!live) return;
        if (s && !sessionRef.current) {
          sessionRef.current = s;
          setSessionState(s);
        }
        setRestoring(false);
      });
    return () => {
      live = false;
    };
  }, [api]);

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
    setAccountError(undefined);
    api.call(getAccount).then(
      (a) => {
        if (live) setAccount(a);
      },
      (e: unknown) => {
        if (live) setAccountError(e);
      },
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
    restoring,
    setSession,
    mode,
    setMode: (m) => navigate(`${location.pathname}${withMode(location.search, m)}`),
    location,
    navigate,
    href: (p) => hrefFor(p, mode),
    account,
    accountError,
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
    registry,
    switchAccount: async (accountId) => {
      const s = await api.call(switchSessionAccount, { body: { account: accountId } });
      setSession(s);
      setAccountTick((t) => t + 1);
      navigate(hrefFor("/", modeRef.current));
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** In-app link that keeps the mode and uses the History API. */
export function Link({
  to,
  children,
  className,
  ...rest
}: { to: string; children: ReactNode; className?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const app = useApp();
  const href = app.href(to);
  return (
    <a
      {...rest}
      href={href}
      className={className}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        app.navigate(href);
      }}
    >
      {children}
    </a>
  );
}
