import { buttonClassName, Input } from "@nearpay-internal/ui";
import { signup } from "@nearpay-money/spec";
import { useEffect, useRef, useState } from "react";
import { Link, useApp } from "../../app/context";
import { ACCOUNTS_PARAM } from "../../app/Shell";
import { AuthLayout } from "../../ui/auth";
import { Button, ErrorNote, Field, Note } from "../../ui/ui";
import {
  AuthDivider,
  continueWithGoogle,
  GoogleButton,
  googleErrorMessage,
  googleErrorOf,
  useAuthMethods,
} from "./google";
import { mountTurnstile } from "./turnstile";

/**
 * `/signup` while signed in (owner decision 2026-11-12): no silent redirect. The page says who is signed in
 * and offers the dashboard, another business account, or signing out to sign up with a different email.
 * There is no API to add a business account for a signed-in user (spec 0.5.1: accounts come from `signup`
 * or an invitation), so "Create another business account" opens the closest existing flow: the account
 * switcher, which lists the user's accounts and explains how another one is added.
 */
export function SignedInSignUp() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const email = app.session?.user.email ?? "";
  return (
    <AuthLayout>
      <div className="dash-auth__head">
        <h1 className="dash-auth__title">You're signed in as {email}</h1>
        <p className="dash-auth__lede">
          You already have a NearPay account
          {app.session?.account.display_name ? ` for ${app.session.account.display_name}` : ""}. What would you like to
          do?
        </p>
      </div>
      <div className="dash-choices" data-testid="signed-in-choices">
        <a href={app.href("/")} className={buttonClassName({ variant: "primary", fullWidth: true })}>
          <span>Go to dashboard</span>
        </a>
        <a
          href={app.href(`/?${ACCOUNTS_PARAM}=open`)}
          className={buttonClassName({ variant: "secondary", fullWidth: true })}
        >
          <span>Create another business account</span>
        </a>
        <Button
          variant="secondary"
          fullWidth
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await app.signOut("/signup");
          }}
        >
          Sign out and use a different email
        </Button>
      </div>
      <p className="dash-auth__note">
        Each business account has its own sign-in email. You can switch between the accounts you belong to from the
        sidebar.
      </p>
    </AuthLayout>
  );
}

export function SignUp() {
  const app = useApp();
  if (app.session) return <SignedInSignUp />;
  return <SignUpForm />;
}

function SignUpForm() {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string>();
  const [widgetError, setWidgetError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>();
  const box = useRef<HTMLDivElement>(null);
  const methods = useAuthMethods(app.api);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<unknown>();
  const googleMessage = googleErrorMessage(googleErrorOf(app.location.search));

  useEffect(() => {
    if (box.current) void mountTurnstile(box.current, setToken, setWidgetError);
  }, []);

  if (sent) {
    return (
      <AuthLayout>
        <h1 className="dash-auth__title">Check your email</h1>
        <Note tone="ok">
          If <strong>{email}</strong> can be used, a sign-up link is on its way. It expires in 15 minutes.
        </Note>
        <p>
          <Link to="/signin">Back to sign in</Link>
        </p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <h1 className="dash-auth__title">Create your NearPay account</h1>
      <p className="dash-auth__lede">
        {methods?.google
          ? "Continue with Google, or we email you a link and you create a passkey on this device."
          : "We email you a link; then you create a passkey on this device."}
      </p>
      {googleMessage ? (
        <div data-testid="google-error">
          <Note tone="error">{googleMessage}</Note>
        </div>
      ) : null}
      {methods?.google ? (
        <>
          <GoogleButton
            busy={googleBusy}
            onClick={async () => {
              setGoogleBusy(true);
              setGoogleError(undefined);
              try {
                await continueWithGoogle(app.api, { intent: "signup" });
              } catch (err) {
                setGoogleError(err);
                setGoogleBusy(false);
              }
            }}
          />
          <ErrorNote error={googleError} />
          <AuthDivider />
        </>
      ) : null}
      <form
        className="dash-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!token) return;
          setBusy(true);
          setError(undefined);
          try {
            await app.api.call(signup, { body: { email: email.trim(), turnstile_token: token } });
            setSent(true);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Work email">
          {(id) => (
            <Input
              id={id}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <div ref={box} className="turnstile" data-testid="turnstile" />
        {widgetError && <Note tone="error">{widgetError}</Note>}
        <Button type="submit" busy={busy} disabled={!token || !email}>
          {token ? "Email me a sign-up link" : "Verifying you are human…"}
        </Button>
      </form>
      <ErrorNote error={error} />
      <p className="dash-auth__alt">
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
