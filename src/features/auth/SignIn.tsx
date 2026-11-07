import { Input } from "@nearpay-internal/ui";
import { useState } from "react";
import { Link, useApp } from "../../app/context";
import { AuthLayout } from "../../ui/auth";
import { Button, ErrorNote, Field } from "../../ui/ui";
import { signInWithPasskey } from "./passkeys";

export function SignIn() {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <AuthLayout>
      <h1 className="np-text-h3">Sign in to NearPay</h1>
      <p className="np-text-secondary">Use the passkey you created at sign-up. No passwords.</p>
      <form
        className="dash-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            const s = await signInWithPasskey(app.api, email.trim() || undefined);
            app.setSession(s);
            const next = new URLSearchParams(app.location.search).get("next");
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
