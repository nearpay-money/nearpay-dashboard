import { Input } from "@nearpay-internal/ui";
import { useEffect, useRef, useState } from "react";
import { Link, useApp } from "../../app/context";
import { AuthLayout } from "../../ui/auth";
import { Button, ErrorNote, Field, Note } from "../../ui/ui";
import {
  AuthDivider,
  continueWithGoogleFromAuthPage,
  GoogleButton,
  GoogleErrorCallout,
  safeNext,
  useAuthMethods,
  useGoogleStart,
  useOneShotParams,
} from "./google";
import { signInWithPasskey } from "./passkeys";

/** `?passkey=1`: sent here to sign in with a passkey (e.g. after `email_exists` on the sign-up page). */
export const PASSKEY_PARAM = "passkey";
const ONE_SHOT = ["google_error", PASSKEY_PARAM] as const;

export function SignIn() {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const methods = useAuthMethods(app.api);
  // read once, then removed from the address bar: a reload never shows a stale Google error
  const params = useOneShotParams(ONE_SHOT);
  const [googleCode, setGoogleCode] = useState(params.google_error);
  const [passkeyHint, setPasskeyHint] = useState(params[PASSKEY_PARAM] === "1");
  const next = safeNext(new URLSearchParams(app.location.search).get("next"));
  const form = useRef<HTMLFormElement>(null);
  const google = useGoogleStart(async () => {
    await continueWithGoogleFromAuthPage(app, { intent: "signin", next });
  });
  const focusPasskey = () => {
    const b = form.current?.querySelector<HTMLButtonElement>("button[type=submit]");
    b?.scrollIntoView?.({ block: "center" });
    b?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when sent here for the passkey option
  useEffect(() => {
    if (passkeyHint) focusPasskey();
  }, []);
  const retryGoogle = () => {
    setGoogleCode(null);
    setPasskeyHint(false);
    void google.start();
  };
  return (
    <AuthLayout>
      <h1 className="dash-auth__title">Sign in to NearPay</h1>
      <p className="dash-auth__lede">
        {methods?.google
          ? "Continue with Google or use your passkey. No passwords."
          : "Use the passkey you created at sign-up. No passwords."}
      </p>
      <GoogleErrorCallout
        code={googleCode}
        googleOn={methods?.google === true}
        busy={google.busy}
        onPasskey={() => {
          setGoogleCode(null);
          setPasskeyHint(true);
          focusPasskey();
        }}
        onGoogle={retryGoogle}
      />
      {passkeyHint ? (
        <div data-testid="passkey-hint">
          <Note tone="info">Sign in with your passkey. Then connect Google in Settings, under Sign-in methods.</Note>
        </div>
      ) : null}
      {methods?.google ? (
        <>
          <GoogleButton busy={google.busy} onClick={retryGoogle} />
          <ErrorNote error={google.error} />
          <AuthDivider />
        </>
      ) : null}
      <form
        ref={form}
        className="dash-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            const s = await signInWithPasskey(app.api, email.trim() || undefined);
            app.setSession(s);
            app.navigate(next ?? "/", { replace: true });
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email (optional)" hint="Leave empty to pick a passkey from your device.">
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="username webauthn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" busy={busy} data-testid="passkey-submit">
          Sign in with passkey
        </Button>
      </form>
      <ErrorNote error={error} />
      <p className="dash-auth__alt">
        New to NearPay? <Link to="/signup">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
