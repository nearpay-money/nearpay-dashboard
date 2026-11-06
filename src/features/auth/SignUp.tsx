import { signup } from "@nearpay/spec";
import { useEffect, useRef, useState } from "react";
import { Link, useApp } from "../../app/context";
import { Button, ErrorNote, Field, Note } from "../../ui/ui";
import { mountTurnstile } from "./turnstile";

export function SignUp() {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string>();
  const [widgetError, setWidgetError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (box.current) void mountTurnstile(box.current, setToken, setWidgetError);
  }, []);

  if (sent) {
    return (
      <div className="auth">
        <h1>Check your email</h1>
        <Note tone="ok">
          If <strong>{email}</strong> can be used, a sign-up link is on its way. It expires in 15 minutes.
        </Note>
        <p>
          <Link to="/signin">Back to sign in</Link>
        </p>
      </div>
    );
  }
  return (
    <div className="auth">
      <h1>Create your NearPay account</h1>
      <p className="muted">We email you a link; then you create a passkey on this device.</p>
      <form
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
            <input
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
      <p>
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </div>
  );
}
