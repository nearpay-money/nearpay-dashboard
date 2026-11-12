/**
 * Continue with Google (ADR-0026, identity LLD §22). The dashboard never talks to Google: it asks identity
 * to start a flow (`startGoogleSignIn` / `startGoogleLink`, which set an HttpOnly flow cookie), sends the
 * top-level window to the returned Google URL, and Google comes back to identity's callback, which
 * redirects to `/setup`, `next`, `/signin?google_error=…` or `/settings/account?google=linked`. No Google
 * script is loaded (CSP, ADR-0010): the button is drawn from a bundled SVG per Google's branding guidelines.
 */

import { Callout } from "@nearpay-internal/ui";
import {
  type AuthMethods as AuthMethodsSchema,
  type GOOGLE_SIGNIN_ERRORS,
  getAuthMethods,
  startGoogleLink,
  startGoogleSignIn,
  type z,
} from "@nearpay-money/spec";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AppState, useApp } from "../../app/context";
import type { ApiClient } from "../../lib/api";
import { restoreSession } from "../../lib/session";
import { Button } from "../../ui/ui";

export type AuthMethods = z.output<typeof AuthMethodsSchema>;
type GoogleError = (typeof GOOGLE_SIGNIN_ERRORS)[number];

/** The refusal for an existing, unlinked email (owner decision, ADR-0026 d5). */
export const EMAIL_EXISTS_COPY =
  "This email already has a NearPay account. Sign in with your passkey, then connect Google in Settings.";

const COPY: Readonly<Record<GoogleError, string>> = {
  cancelled: "Google sign-in was canceled.",
  state_invalid: "That Google sign-in expired or was started in another browser. Try again.",
  token_invalid: "Google sign-in couldn't be verified. Try again.",
  email_unverified: "Google hasn't verified this email address yet. Verify it with Google, or use another account.",
  email_exists: EMAIL_EXISTS_COPY,
  account_disabled: "This NearPay user is disabled. Contact support.",
  no_account: "This NearPay user doesn't belong to any account any more. Ask an owner to invite you again.",
  identity_in_use: "That Google account is already connected to another NearPay user.",
  already_linked: "Your user is already connected to a Google account. Disconnect it first.",
  link_session_invalid: "Your session ended before Google answered. Sign in and try again.",
  unavailable: "Google couldn't be reached. Try again in a moment.",
  disabled: "Continue with Google isn't available right now. Use your passkey.",
};

/** User-facing text for a `google_error` query value, or null. Unknown values get a generic message. */
export function googleErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return (COPY as Record<string, string>)[code] ?? "Google sign-in didn't complete. Try again.";
}

/** `?google_error=` of a search string. */
export const googleErrorOf = (search: string): string | null => new URLSearchParams(search).get("google_error");

/** A same-origin dashboard path (`/x?y`), never `//host`, `/\host`, a scheme or whitespace. */
export const safeNext = (next: string | null | undefined): string | null =>
  typeof next === "string" && next.length <= 512 && /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : null;

/**
 * One-shot query parameters (`google_error`, `google`, `add_passkey`, `passkey`): their values and the
 * search string without them (other parameters such as `next` and `mode` stay, in order).
 */
export function takeParams(
  search: string,
  names: readonly string[],
): { readonly values: Readonly<Record<string, string | null>>; readonly rest: string; readonly found: boolean } {
  const q = new URLSearchParams(search);
  const values: Record<string, string | null> = {};
  let found = false;
  for (const n of names) {
    values[n] = q.get(n);
    if (q.has(n)) found = true;
    q.delete(n);
  }
  const rest = q.toString();
  return { values, rest: rest ? `?${rest}` : "", found };
}

/**
 * Reads one-shot parameters once, when the page mounts, then removes them from the address bar
 * (`history.replaceState` through `navigate`), so a reload or a shared link never shows a stale banner.
 */
export function useOneShotParams(names: readonly string[]): Readonly<Record<string, string | null>> {
  const app = useApp();
  const [taken] = useState(() => takeParams(app.location.search, names));
  const cleaned = useRef(false);
  useEffect(() => {
    if (cleaned.current || !taken.found) return;
    cleaned.current = true;
    const now = takeParams(app.location.search, names);
    if (now.found) app.navigate(`${app.location.pathname}${now.rest}`, { replace: true });
  }, [app, names, taken.found]);
  return taken.values;
}

let cached: AuthMethods | undefined;

/** The last answer of `GET /v1/auth/methods` (sign-in ↔ sign-up navigation renders without a flicker). */
export const cachedAuthMethods = (): AuthMethods | undefined => cached;
export function setCachedAuthMethods(m: AuthMethods | undefined): void {
  cached = m;
}

/** Whether to show the Google button; a failed lookup hides it (passkeys always work). */
export async function loadAuthMethods(api: Pick<ApiClient, "call">): Promise<AuthMethods | undefined> {
  try {
    cached = await api.call(getAuthMethods);
  } catch {
    cached = undefined;
  }
  return cached;
}

export function useAuthMethods(api: Pick<ApiClient, "call">): AuthMethods | undefined {
  const [m, setM] = useState<AuthMethods | undefined>(cachedAuthMethods);
  useEffect(() => {
    let live = true;
    void loadAuthMethods(api).then((v) => {
      if (live) setM(v);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return m;
}

/** Only an https URL is followed (never a script or relative URL, even from a broken API). */
export function safeAuthorizationUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Google sign-in returned an unexpected address.");
  return u.toString();
}

type Assign = (url: string) => void;
const browserAssign: Assign = (url) => window.location.assign(url);

/**
 * Sign-in / sign-up: start a new flow (every click: a fresh state, nonce and flow cookie; nothing of a
 * failed flow is reused), then leave for Google, which shows its account chooser. `next` must be a
 * same-origin path.
 */
export async function continueWithGoogle(
  api: Pick<ApiClient, "call">,
  o: { intent: "signin" | "signup"; next?: string | null },
  assign: Assign = browserAssign,
): Promise<void> {
  const next = safeNext(o.next);
  const r = await api.call(startGoogleSignIn, { body: { intent: o.intent, ...(next ? { next } : {}) } });
  assign(safeAuthorizationUrl(r.authorization_url));
}

/**
 * State of a button that leaves for Google: busy while the flow starts, the error if starting failed.
 * Busy is cleared when the browser restores the page from the back/forward cache (the user pressed Back
 * at Google), so the button never stays stuck.
 */
export function useGoogleStart(fn: () => Promise<void>): {
  readonly busy: boolean;
  readonly error: unknown;
  start(): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const start = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      await fnRef.current();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }, []);
  return { busy, error, start };
}

/**
 * Sign-in / sign-up "Continue with Google": a user who is in fact already signed in (another tab, a
 * session restored after the page drew) is not sent to Google: the session is picked up instead, and the
 * app shows what it shows any signed-in user on that page (sign-in: the dashboard or `next`; sign-up: the
 * signed-in choice page).
 */
export async function continueWithGoogleFromAuthPage(
  app: Pick<AppState, "api" | "setSession">,
  o: { intent: "signin" | "signup"; next?: string | null },
  assign: Assign = browserAssign,
): Promise<"signed_in" | "google"> {
  const s = await restoreSession(app.api).catch(() => null);
  if (s) {
    app.setSession(s);
    return "signed_in";
  }
  await continueWithGoogle(app.api, o, assign);
  return "google";
}

/** Errors that ask the user to pick another Google account rather than repeat the same attempt. */
const OTHER_ACCOUNT = new Set<string>(["email_exists"]);

/**
 * The callout for a `google_error` on the sign-in and sign-up pages, with the next steps:
 * `email_exists` → "Sign in with passkey" (primary) and "Use a different Google account"; `disabled` →
 * no Google action (the button is hidden); anything else → "Try again".
 */
export function GoogleErrorCallout({
  code,
  googleOn,
  busy = false,
  onPasskey,
  onGoogle,
}: {
  code: string | null | undefined;
  googleOn: boolean;
  busy?: boolean;
  onPasskey(): void;
  onGoogle(): void;
}) {
  const message = googleErrorMessage(code);
  if (!code || !message) return null;
  const retry = googleOn && code !== "disabled";
  const passkeyFirst = OTHER_ACCOUNT.has(code);
  return (
    <Callout tone="danger" role="alert" title={message} className="dash-google-error" data-testid="google-error">
      {passkeyFirst || retry ? (
        <div
          className={`dash-google-error__actions${passkeyFirst && retry ? " dash-google-error__actions--pair" : ""}`}
        >
          {passkeyFirst ? (
            <Button size="sm" onClick={onPasskey} data-testid="google-error-passkey">
              Sign in with passkey
            </Button>
          ) : null}
          {retry ? (
            <Button size="sm" variant="secondary" busy={busy} onClick={onGoogle} data-testid="google-error-retry">
              {passkeyFirst ? "Use a different Google account" : "Try again"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Callout>
  );
}

/** Settings → Connect Google (the API asks for a step-up first; the client replays after it). */
export async function connectGoogle(api: Pick<ApiClient, "call">, assign: Assign = browserAssign): Promise<void> {
  const r = await api.call(startGoogleLink, { body: {} });
  assign(safeAuthorizationUrl(r.authorization_url));
}

/** Google's "G" mark (standard colours), per the Sign in with Google branding guidelines. */
export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

/** The standard light "Continue with Google" button (white, grey outline, G mark, fixed text). */
export function GoogleButton({
  onClick,
  busy = false,
  disabled = false,
  label = "Continue with Google",
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  label?: "Continue with Google" | "Connect Google";
}) {
  return (
    <button
      type="button"
      className="dash-google-btn"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-testid="google-button"
    >
      <span className="dash-google-btn__icon">
        <GoogleG />
      </span>
      <span className="dash-google-btn__label">{label}</span>
    </button>
  );
}

/** "or" between Google and the passkey form. */
export function AuthDivider() {
  return (
    <div className="dash-auth__or" aria-hidden="true">
      <span>or</span>
    </div>
  );
}
