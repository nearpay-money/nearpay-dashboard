import { Input } from "@nearpay-internal/ui";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
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
import { signInWithPasskey } from "./passkeys";

export function SignIn() {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const methods = useAuthMethods(app.api);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<unknown>();
  const googleMessage = googleErrorMessage(googleErrorOf(app.location.search));
  const next = new URLSearchParams(app.location.search).get("next");
  return (
    <AuthLayout>
      <h1 className="np-text-h3">Sign in to NearPay</h1>
      <p className="np-text-secondary">
        {methods?.google
          ? "Continue with Google or use your passkey. No passwords."
          : "Use the passkey you created at sign-up. No passwords."}
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
                await continueWithGoogle(app.api, { intent: "signin", next });
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
          setBusy(true);
          setError(undefined);
          try {
            const s = await signInWithPasskey(app.api, email.trim() || undefined);
            app.setSession(s);
            app.navigate(next?.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
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
        <Button type="submit" busy={busy}>
          Sign in with passkey
        </Button>
      </form>
      <ErrorNote error={error} />
      <p>
        New to NearPay? <Link to="/signup">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
