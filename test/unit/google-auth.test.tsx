/**
 * Continue with Google (ADR-0026): the sign-in and sign-up pages, the Settings "Sign-in methods" section, the
 * step-up dialog's choice for Google-only users, and the flow helpers (component tests render to static
 * markup in Node, like test/unit/wallet-picker.test.tsx; real clicks are in src/features/auth/google.e2e.ts).
 */
import { getAuthMethods, startGoogleLink, startGoogleSignIn } from "@nearpay-money/spec";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext, type AppState } from "../../src/app/context";
import { stepUpMode } from "../../src/app/StepUp";
import {
  connectGoogle,
  continueWithGoogle,
  EMAIL_EXISTS_COPY,
  googleErrorMessage,
  googleErrorOf,
  loadAuthMethods,
  safeAuthorizationUrl,
  setCachedAuthMethods,
} from "../../src/features/auth/google";
import { SignIn } from "../../src/features/auth/SignIn";
import { SignInMethodsView, type SignInMethodsViewProps, settingsNotice } from "../../src/features/auth/SignInMethods";
import { SignUp } from "../../src/features/auth/SignUp";

const GOOGLE_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s";

function stubApp(search = ""): AppState {
  return {
    api: { call: async () => undefined },
    location: { pathname: "/signin", search },
    session: null,
    restoring: false,
    navigate() {},
    href: (p: string) => p,
    setSession() {},
  } as unknown as AppState;
}

const render = (node: React.ReactNode, app = stubApp()) =>
  renderToStaticMarkup(<AppContext.Provider value={app}>{node}</AppContext.Provider>);

afterEach(() => setCachedAuthMethods(undefined));

describe("sign-in page", () => {
  it("shows Continue with Google above the passkey form when identity has a Google client", () => {
    setCachedAuthMethods({ object: "auth_methods", passkey: true, google: true });
    const html = render(<SignIn />);
    const g = html.indexOf("Continue with Google</span>");
    const pk = html.indexOf("Sign in with passkey");
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(pk);
    expect(html).toContain('class="dash-google-btn"');
    expect(html).toContain('fill="#4285F4"'); // the Google "G" mark, drawn locally
    expect(html).not.toContain("<script");
  });

  it("hides it when Google sign-in is off or unknown", () => {
    expect(render(<SignIn />)).not.toContain("Continue with Google");
    setCachedAuthMethods({ object: "auth_methods", passkey: true, google: false });
    expect(render(<SignIn />)).not.toContain("google-button");
  });

  it("explains a refused existing email from the callback", () => {
    setCachedAuthMethods({ object: "auth_methods", passkey: true, google: true });
    const html = render(<SignIn />, stubApp("?google_error=email_exists"));
    expect(html).toContain(EMAIL_EXISTS_COPY.replace(/'/g, "&#x27;"));
  });
});

describe("sign-up page", () => {
  it("shows Continue with Google above the email form", () => {
    setCachedAuthMethods({ object: "auth_methods", passkey: true, google: true });
    const html = render(<SignUp />);
    expect(html.indexOf("Continue with Google</span>")).toBeLessThan(html.indexOf("Work email"));
    expect(html.indexOf("Continue with Google</span>")).toBeGreaterThan(0);
  });
  it("shows Google errors and no button when off", () => {
    const html = render(<SignUp />, stubApp("?google_error=email_unverified"));
    expect(html).toContain("Google hasn&#x27;t verified this email");
    expect(html).not.toContain("google-button");
  });
});

describe("Settings: sign-in methods", () => {
  const base: SignInMethodsViewProps = {
    passkeys: 2,
    googleEnabled: true,
    google: null,
    passkeySetupUntil: null,
    nowSec: 1_000,
    onAddPasskey() {},
    onConnect() {},
    onDisconnect() {},
    onGoogleAgain() {},
  };
  const view = (p: Partial<SignInMethodsViewProps> = {}) =>
    renderToStaticMarkup(<SignInMethodsView {...base} {...p} />);

  it("passkey user without Google: Connect Google", () => {
    const html = view();
    expect(html).toContain("2 passkeys");
    expect(html).toContain("Connect Google");
    expect(html).not.toContain("Disconnect Google");
  });
  it("linked user with a passkey: Disconnect enabled", () => {
    const html = view({
      google: { object: "linked_identity", provider: "google", email: "me@gmail.test", created: 1 },
    });
    expect(html).toContain("me@gmail.test");
    expect(html).toMatch(/<button[^>]*>(?:(?!disabled).)*Disconnect Google/);
  });
  it("Google-only user: Disconnect disabled; first passkey offered inside the window, else Google again", () => {
    const google = {
      object: "linked_identity" as const,
      provider: "google" as const,
      email: "me@gmail.test",
      created: 1,
    };
    const inWindow = view({ passkeys: 0, google, passkeySetupUntil: 1_500 });
    expect(inWindow).toContain("Add a passkey before disconnecting Google");
    expect(inWindow).toMatch(/disabled=""[^>]*>[^<]*(<[^>]+>[^<]*)*Disconnect Google/);
    expect(inWindow).toContain(">Add a passkey<");
    const stale = view({ passkeys: 0, google, passkeySetupUntil: 900 });
    expect(stale).toContain("Continue with Google to add a passkey");
  });
  it("hides the Google part when sign-in with Google is off and nothing is linked", () => {
    expect(view({ googleEnabled: false })).not.toContain("google-method");
  });
  it("notices from the callback redirect", () => {
    expect(settingsNotice("?google=linked")).toMatchObject({ tone: "ok" });
    expect(settingsNotice("?google_error=identity_in_use")?.text).toMatch(/another NearPay user/);
    expect(settingsNotice("")).toBeNull();
  });
});

describe("step-up dialog for Google-only users", () => {
  it("passkey users confirm; Google-only users add a passkey in the window, else continue with Google", () => {
    expect(stepUpMode(undefined, 0)).toBe("confirm");
    expect(stepUpMode({ passkeys: 1, passkey_setup_until: null }, 0)).toBe("confirm");
    expect(stepUpMode({ passkeys: 0, passkey_setup_until: 100 }, 50)).toBe("add_passkey");
    expect(stepUpMode({ passkeys: 0, passkey_setup_until: 100 }, 150)).toBe("google_again");
    expect(stepUpMode({ passkeys: 0, passkey_setup_until: null }, 0)).toBe("google_again");
  });
});

describe("flow helpers", () => {
  it("error copy, including unknown codes", () => {
    expect(googleErrorMessage("email_exists")).toBe(EMAIL_EXISTS_COPY);
    expect(googleErrorMessage("something_new")).toMatch(/didn't complete/);
    expect(googleErrorMessage(null)).toBeNull();
    expect(googleErrorOf("?a=1&google_error=cancelled")).toBe("cancelled");
  });

  it("starts the flow and leaves for Google; only same-origin next paths are sent", async () => {
    const calls: { id: string; body: unknown }[] = [];
    const api = {
      call: async (route: { id: string }, input?: { body?: unknown }) => {
        calls.push({ id: route.id, body: input?.body });
        return { object: "google_authorization", authorization_url: GOOGLE_URL, expires_at: 1 };
      },
    } as never;
    const went: string[] = [];
    await continueWithGoogle(api, { intent: "signin", next: "/payments?x=1" }, (u) => went.push(u));
    await continueWithGoogle(api, { intent: "signup", next: "//evil.test" }, (u) => went.push(u));
    await connectGoogle(api, (u) => went.push(u));
    expect(calls).toEqual([
      { id: startGoogleSignIn.id, body: { intent: "signin", next: "/payments?x=1" } },
      { id: startGoogleSignIn.id, body: { intent: "signup" } },
      { id: startGoogleLink.id, body: {} },
    ]);
    expect(went).toEqual([GOOGLE_URL, GOOGLE_URL, GOOGLE_URL]);
  });

  it("never follows a non-https authorization URL", () => {
    expect(() => safeAuthorizationUrl("javascript:alert(1)")).toThrow();
    expect(() => safeAuthorizationUrl("http://accounts.google.com/x")).toThrow();
    expect(safeAuthorizationUrl(GOOGLE_URL)).toBe(GOOGLE_URL);
  });

  it("a failed methods lookup hides the button (passkeys always work)", async () => {
    const ok = { call: async () => ({ object: "auth_methods", passkey: true, google: true }) } as never;
    expect((await loadAuthMethods(ok))?.google).toBe(true);
    const failing = {
      call: async (r: { id: string }) => {
        expect(r.id).toBe(getAuthMethods.id);
        throw new Error("down");
      },
    } as never;
    expect(await loadAuthMethods(failing)).toBeUndefined();
  });
});
